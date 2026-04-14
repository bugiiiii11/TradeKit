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
import { handleKillSwitch, handleManualTrade, handleResume } from "../commands/handlers";

/** Command row shape as stored in public.bot_commands */
interface CommandRow {
  id: string;
  type: string;
  payload: unknown;
  status: "pending" | "running" | "done" | "failed";
}

type Handler = (
  payload: unknown,
  ctx: CommandHandlerContext
) => Promise<CommandResult>;

const HANDLERS: Record<string, Handler> = {
  kill_switch: handleKillSwitch,
  resume: handleResume,
  manual_trade: handleManualTrade,
};

let _channel: RealtimeChannel | null = null;

/**
 * Starts the command subscription. Idempotent — a second call is a no-op.
 * Returns without throwing if Supabase env vars are missing (graceful
 * degradation, same pattern as the other db/ modules).
 */
export async function startCommandSubscription(
  ctx: CommandHandlerContext
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
  try {
    const { data: pending, error } = await supabase
      .from("bot_commands")
      .select("id, type, payload, status")
      .eq("status", "pending")
      .order("issued_at", { ascending: true });

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
  _channel = supabase
    .channel("bot_commands_stream")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "bot_commands" },
      (payload) => {
        const row = payload.new as CommandRow;
        // Fire-and-forget — processCommand handles its own errors and writes
        // result/error back to the row. Never throws to Realtime internals.
        processCommand(row, ctx).catch((err) =>
          console.error(`[Commands] processCommand threw for ${row.id}:`, err)
        );
      }
    )
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        console.log("[Commands] Realtime subscription active");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error(
          `[Commands] Realtime subscription ${status}`,
          err ? `: ${err.message}` : ""
        );
      } else if (status === "CLOSED") {
        console.warn("[Commands] Realtime subscription closed");
      }
    });
}

/**
 * Stops the command subscription. Called on SIGINT/SIGTERM for a clean
 * shutdown so the Realtime channel doesn't linger.
 */
export async function stopCommandSubscription(): Promise<void> {
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
