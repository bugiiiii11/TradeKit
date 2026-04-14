"use server";

/**
 * Server Actions for the command bus.
 *
 * The frontend inserts rows into `public.bot_commands`. The running bot
 * subscribes via Supabase Realtime (see src/db/commands.ts) and processes
 * each row via the claim-then-execute pattern. Result/error is written
 * back to the same row and the dashboard reads it on next refresh.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CommandType = "kill_switch" | "resume" | "manual_trade";

export type CommandActionResult =
  | { ok: true; id: string; result?: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Poll interval (ms) between `bot_commands.status` reads while waiting for
 * the bot to reach a terminal state.
 */
const POLL_INTERVAL_MS = 150;

/**
 * Max time (ms) to wait for the bot to finish a command before giving up.
 * Generous enough for LIVE kill switches that close multiple positions
 * (each Hyperliquid close takes ~1–3s). In DRY_RUN the terminal status
 * lands in under a second.
 */
const POLL_TIMEOUT_MS = 15_000;

/**
 * Inserts a command row and waits for the bot to finish processing it before
 * returning. This eliminates the insert→revalidate race that used to make
 * the UI require two clicks to reflect the new state:
 *
 *   1. Insert row with status='pending'
 *   2. Poll the row until status transitions to 'done' or 'failed'
 *   3. Only then call revalidatePath — by now the bot has already written
 *      an immediate risk_snapshots row (see src/commands/handlers.ts), so
 *      the next render definitely sees the new killed state.
 *
 * Requires an authenticated user — otherwise RLS will reject the insert.
 */
export async function issueCommand(
  type: CommandType,
  payload: Record<string, unknown> = {},
): Promise<CommandActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not authenticated" };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("bot_commands")
    .insert({ type, payload, status: "pending" })
    .select("id")
    .single();

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  const commandId = inserted.id as string;

  // Wait for the bot to finish. Polling is simpler than a Realtime
  // subscription for a one-shot wait, and the server action is already
  // a short-lived request.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let finalStatus: "done" | "failed" | null = null;
  let finalError: string | null = null;
  let finalResult: Record<string, unknown> | undefined = undefined;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const { data: row } = await supabase
      .from("bot_commands")
      .select("status, error, result")
      .eq("id", commandId)
      .single();

    if (row?.status === "done") {
      finalStatus = "done";
      finalResult = (row.result as Record<string, unknown> | null) ?? undefined;
      break;
    }
    if (row?.status === "failed") {
      finalStatus = "failed";
      finalError = (row.error as string | null) ?? "Command failed";
      break;
    }
  }

  // Revalidate unconditionally — even on timeout, the bot may have written
  // state changes we want the dashboard to catch on next render.
  revalidatePath("/");

  if (finalStatus === "done") {
    return { ok: true, id: commandId, result: finalResult };
  }
  if (finalStatus === "failed") {
    return { ok: false, error: finalError ?? "Command failed" };
  }
  return {
    ok: false,
    error: `Bot did not respond within ${Math.round(POLL_TIMEOUT_MS / 1000)}s — is it running?`,
  };
}

/** Convenience wrapper for the kill switch button. */
export async function killSwitch(reason?: string): Promise<CommandActionResult> {
  return issueCommand("kill_switch", reason ? { reason } : {});
}

/** Convenience wrapper for the resume button. */
export async function resumeBot(): Promise<CommandActionResult> {
  return issueCommand("resume", {});
}

export interface ManualTradeParams {
  direction: "long" | "short";
  leverage: number;
  notionalUsd: number;
  slPrice: number;
  tpTargets: Array<{ price: number; portion: number }>;
}

/** Place a manual BTC trade via the command bus. */
export async function issueManualTrade(
  params: ManualTradeParams,
): Promise<CommandActionResult> {
  return issueCommand("manual_trade", params as unknown as Record<string, unknown>);
}
