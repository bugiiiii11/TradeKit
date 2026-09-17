/**
 * Supabase bot_commands subscription + dispatcher.
 *
 * Flow:
 *   1. On startup, sweep any rows with status='pending' that may have
 *      arrived while the bot was down. Process them before subscribing so
 *      no command is ever silently dropped on restart.
 *   2. Subscribe to postgres_changes (INSERT) on public.bot_commands via
 *      Supabase Realtime. The bot_commands table was added to the
 *      supabase_realtime publication in migration 007.
 *   3. On every row, run the claim-then-execute pattern:
 *      - UPDATE status='running' WHERE id=$1 AND status='pending'
 *      - If rowcount 0, another consumer got it — skip.
 *      - Otherwise, dispatch to the handler, then UPDATE with result/error.
 *
 * The claim pattern prevents double-processing on:
 *   - Realtime message redelivery
 *   - A pending sweep racing a Realtime INSERT for the same row
 *   - A future second bot instance (not supported today but safe by default)
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import type { CommandHandlerContext, CommandResult } from "../commands/handlers";
import {
  handleKillSwitch,
  handleManualTrade,
  handleResume,
  handleToggleStrategy,
  handleToggleS1Filter,
  handleSetLeverage,
} from "../commands/handlers";

/** Command row shape as stored in public.bot_commands */
interface CommandRow {
  id: string;
  type: string;
  payload: unknown;
  status: "pending" | "running" | "done" | "failed";
  target?: string | null;
}

type Handler = (
  payload: unknown,
  ctx: CommandHandlerContext
) => Promise<CommandResult>;

const HANDLERS: Record<string, Handler> = {
  kill_switch: handleKillSwitch,
  resume: handleResume,
  manual_trade: handleManualTrade,
  toggle_strategy: handleToggleStrategy,
  toggle_s1_filter: handleToggleS1Filter,
  set_leverage: handleSetLeverage,
};

let _channel: RealtimeChannel | null = null;
let _lastRealtimeStatus: string | null = null;
let _realtimeErrorCount = 0;
let _stopped = false;
let _resubscribeTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * True only while WE are tearing a channel down on purpose. removeChannel()
 * synchronously fires that channel's own subscribe callback with status CLOSED
 * (verified against @supabase/realtime-js 2.103.0), so without this flag our
 * own teardown is indistinguishable from the server dropping us - and arms yet
 * another resubscribe. That was the S52 flap: one genuine close on 2026-08-21
 * latched the bot into killing its own healthy channel every 30s, forever.
 */
let _tearingDown = false;

const RESUBSCRIBE_DELAY_MS = 30_000;

/**
 * A CLOSED channel never comes back on its own (Jun 28 2026: channel closed
 * and the kill switch was dead for 7+ weeks). Tear down and re-run the full
 * startCommandSubscription — the startup sweep also catches any commands that
 * arrived while the channel was down, and the claim pattern makes re-sweeping
 * safe.
 */
function scheduleResubscribe(ctx: CommandHandlerContext, botSource?: string): void {
  if (_stopped || _resubscribeTimer) return;
  _resubscribeTimer = setTimeout(async () => {
    _resubscribeTimer = null;
    if (_stopped) return;
    const supabase = getSupabase();
    if (supabase && _channel) {
      _tearingDown = true;
      try {
        await supabase.removeChannel(_channel);
      } catch { /* ignore */ } finally {
        _tearingDown = false;
      }
    }
    _channel = null;
    _lastRealtimeStatus = null;
    console.log("[Commands] Resubscribing to command channel...");
    try {
      await startCommandSubscription(ctx, botSource);
    } catch (err) {
      console.error("[Commands] Resubscribe failed — will retry:", err);
      scheduleResubscribe(ctx, botSource);
    }
  }, RESUBSCRIBE_DELAY_MS);
}

/**
 * Starts the command subscription. Idempotent — a second call is a no-op.
 * Returns without throwing if Supabase env vars are missing (graceful
 * degradation, same pattern as the other db/ modules).
 */
export async function startCommandSubscription(
  ctx: CommandHandlerContext,
  botSource?: string,
): Promise<void> {
  if (_channel) {
    console.warn("[Commands] Subscription already started — ignoring");
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    console.warn(
      "[Commands] Supabase not configured — command bus disabled. " +
        "The kill switch will not work until SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY are set."
    );
    return;
  }

  // 1. Startup sweep — process any commands that arrived while bot was down.
  //    If botSource is set, only process commands targeting this bot (or untargeted).
  try {
    let sweepQuery = supabase
      .from("bot_commands")
      .select("id, type, payload, status, target")
      .eq("status", "pending")
      .order("issued_at", { ascending: true });

    if (botSource) {
      sweepQuery = sweepQuery.or(`target.eq.${botSource},target.is.null`);
    }

    const { data: pending, error } = await sweepQuery;

    if (error) {
      console.error("[Commands] Startup sweep query failed:", error.message);
    } else if (pending && pending.length > 0) {
      console.warn(
        `[Commands] Startup sweep — processing ${pending.length} pending command(s)`
      );
      for (const row of pending) {
        await processCommand(row as CommandRow, ctx);
      }
    } else {
      console.log("[Commands] Startup sweep — no pending commands");
    }
  } catch (err) {
    console.error("[Commands] Startup sweep exception:", err);
  }

  // 2. Realtime subscription. `chan` lets the status callback tell its own
  //    channel apart from a newer one created by a later resubscribe.
  let chan: RealtimeChannel | null = null;
  chan = supabase
    .channel("bot_commands_stream")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "bot_commands" },
      (payload) => {
        const row = payload.new as CommandRow;
        // Skip commands targeting a different bot
        if (botSource && row.target && row.target !== botSource) return;
        processCommand(row, ctx).catch((err) =>
          console.error(`[Commands] processCommand threw for ${row.id}:`, err)
        );
      }
    )
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        const msg = _realtimeErrorCount > 0
          ? `[Commands] Realtime subscription active (recovered after ${_realtimeErrorCount} retries)`
          : "[Commands] Realtime subscription active";
        console.log(msg);
        _realtimeErrorCount = 0;
        _lastRealtimeStatus = status;
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        _realtimeErrorCount++;
        if (_lastRealtimeStatus !== status) {
          console.error(
            `[Commands] Realtime subscription ${status}`,
            err ? `: ${err.message}` : ""
          );
        }
        _lastRealtimeStatus = status;
      } else if (status === "CLOSED") {
        // Ignore closes we caused ourselves (teardown / shutdown) and closes
        // reported by a channel from an earlier generation - neither means the
        // live channel is gone, and acting on them re-arms the timer forever.
        const stale = _channel !== null && chan !== null && chan !== _channel;
        if (!_stopped && !_tearingDown && !stale) {
          console.warn(`[Commands] Realtime subscription closed — resubscribing in ${RESUBSCRIBE_DELAY_MS / 1000}s`);
          scheduleResubscribe(ctx, botSource);
        }
        _lastRealtimeStatus = status;
      }
    });
  _channel = chan;
}

/**
 * Stops the command subscription. Called on SIGINT/SIGTERM for a clean
 * shutdown so the Realtime channel doesn't linger.
 */
export async function stopCommandSubscription(): Promise<void> {
  _stopped = true;
  if (_resubscribeTimer) {
    clearTimeout(_resubscribeTimer);
    _resubscribeTimer = null;
  }
  if (!_channel) return;
  const supabase = getSupabase();
  if (supabase) {
    await supabase.removeChannel(_channel);
  }
  _channel = null;
}

/**
 * Claim-then-execute a single command row. Safe to call from both the
 * startup sweep and the Realtime INSERT handler — the atomic claim
 * prevents double-processing.
 */
async function processCommand(
  row: CommandRow,
  ctx: CommandHandlerContext
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  // Atomic claim: only succeeds if the row is still pending. If a concurrent
  // consumer already claimed it, `data` will be an empty array and we skip.
  const { data: claimed, error: claimError } = await supabase
    .from("bot_commands")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id");

  if (claimError) {
    console.error(
      `[Commands] Claim failed for ${row.id}: ${claimError.message}`
    );
    return;
  }
  if (!claimed || claimed.length === 0) {
    // Someone else claimed it — normal race condition during startup sweep.
    return;
  }

  console.log(`[Commands] Executing ${row.type} (id: ${row.id.slice(0, 8)}…)`);

  const handler = HANDLERS[row.type];
  if (!handler) {
    await supabase
      .from("bot_commands")
      .update({
        status: "failed",
        error: `Unknown command type: ${row.type}`,
        finished_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    console.warn(`[Commands] Unknown command type: ${row.type}`);
    return;
  }

  let result: CommandResult;
  try {
    result = await handler(row.payload, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result = { ok: false, error: msg };
  }

  const finishedAt = new Date().toISOString();
  if (result.ok) {
    await supabase
      .from("bot_commands")
      .update({
        status: "done",
        result: result.result,
        finished_at: finishedAt,
      })
      .eq("id", row.id);
    console.log(`[Commands] ${row.type} done (id: ${row.id.slice(0, 8)}…)`);
  } else {
    await supabase
      .from("bot_commands")
      .update({
        status: "failed",
        error: result.error,
        finished_at: finishedAt,
      })
      .eq("id", row.id);
    console.error(
      `[Commands] ${row.type} failed (id: ${row.id.slice(0, 8)}…): ${result.error}`
    );
  }
}
