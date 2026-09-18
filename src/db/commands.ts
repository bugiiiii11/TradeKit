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
let _resubscribeAttempts = 0;
let _subscribedAt = 0;

const RESUBSCRIBE_BASE_DELAY_MS = 30_000;
const RESUBSCRIBE_MAX_DELAY_MS = 5 * 60_000;
/** A subscription that stayed up this long counts as healthy — backoff resets. */
const STABLE_SUBSCRIPTION_MS = 10 * 60_000;

function resubscribeDelayMs(): number {
  return Math.min(
    RESUBSCRIBE_BASE_DELAY_MS * 2 ** _resubscribeAttempts,
    RESUBSCRIBE_MAX_DELAY_MS,
  );
}

/**
 * Removes the current channel. `_channel` is cleared BEFORE removeChannel so
 * the old channel's subscribe-callback (which realtime-js fires with CLOSED on
 * unsubscribe) sees `_channel !== channel` and ignores itself. Missing that
 * ordering is what caused the S50 30s teardown loop.
 */
async function teardownChannel(): Promise<void> {
  const old = _channel;
  _channel = null;
  _lastRealtimeStatus = null;
  if (!old) return;
  const supabase = getSupabase();
  if (supabase) {
    try { await supabase.removeChannel(old); } catch { /* ignore */ }
  }
}

/**
 * A CLOSED channel never comes back on its own (Jun 28 2026: channel closed
 * and the kill switch was dead for 7+ weeks). Tear down and re-run the full
 * startCommandSubscription — the startup sweep also catches any commands that
 * arrived while the channel was down, and the claim pattern makes re-sweeping
 * safe. Exponential backoff (30s → 5 min) so a persistently failing channel
 * can't flood bot_logs (Aug 22 → Sep 18 2026: ~11.5k rows/day at a fixed 30s).
 */
function scheduleResubscribe(ctx: CommandHandlerContext, botSource?: string): void {
  if (_stopped || _resubscribeTimer) return;
  const delay = resubscribeDelayMs();
  console.warn(
    `[Commands] Resubscribing in ${delay / 1000}s (attempt ${_resubscribeAttempts + 1})`
  );
  _resubscribeTimer = setTimeout(async () => {
    _resubscribeTimer = null;
    if (_stopped) return;
    _resubscribeAttempts++;
    await teardownChannel();
    console.log("[Commands] Resubscribing to command channel...");
    try {
      await startCommandSubscription(ctx, botSource);
    } catch (err) {
      console.error("[Commands] Resubscribe failed — will retry:", err);
      scheduleResubscribe(ctx, botSource);
    }
  }, delay);
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

  // 2. Realtime subscription.
  const channel = supabase
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
    );
  _channel = channel;

  channel.subscribe((status, err) => {
    // Stale callback from a channel we already replaced or tore down —
    // realtime-js fires CLOSED on unsubscribe. Acting on it here re-armed the
    // resubscribe timer against a healthy channel every 30s (S50).
    if (_channel !== channel) return;

    if (status === "SUBSCRIBED") {
      const msg = _realtimeErrorCount > 0
        ? `[Commands] Realtime subscription active (recovered after ${_realtimeErrorCount} retries)`
        : "[Commands] Realtime subscription active";
      console.log(msg);
      _realtimeErrorCount = 0;
      _subscribedAt = Date.now();
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
      if (!_stopped && _lastRealtimeStatus !== status) {
        // A subscription that held for a while was healthy — don't let one
        // real close inherit backoff from an old failure streak.
        if (_subscribedAt && Date.now() - _subscribedAt > STABLE_SUBSCRIPTION_MS) {
          _resubscribeAttempts = 0;
        }
        console.warn(
          `[Commands] Realtime subscription closed ` +
            `(socket: ${supabase.realtime.connectionState()}, ` +
            `held ${_subscribedAt ? Math.round((Date.now() - _subscribedAt) / 1000) : 0}s)`
        );
        scheduleResubscribe(ctx, botSource);
      }
      _lastRealtimeStatus = status;
    }
  });
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
  await teardownChannel();
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
