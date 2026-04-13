/**
 * Command handlers — executed by the command subscription when a
 * `bot_commands` row arrives from the frontend (or is inserted directly
 * via Supabase MCP for testing).
 *
 * Each handler returns a `CommandResult` that the subscription writes back
 * to the row (`result` jsonb on success, `error` text on failure). Handlers
 * must be idempotent enough that a repeated delivery is safe — the
 * subscription's claim-then-execute pattern guards against double-processing
 * in the common case, but network retries can still happen.
 */

import { getOpenPositions } from "../hyperliquid/account";
import { closePosition } from "../hyperliquid/orders";
import { clearKilled, getState, setKilled } from "../risk/state";
import { writeRiskSnapshot } from "../db/snapshots";

const DRY_RUN = (process.env.DRY_RUN ?? "false").toLowerCase() === "true";

/**
 * Context passed in by the subscription so handlers can mutate bot-level
 * state without importing from `main.ts` (would create a circular dep).
 */
export interface CommandHandlerContext {
  /**
   * Clears the bot's in-memory `activePositions[]` tracking. Called after a
   * kill switch so the next `runLoop` tick doesn't try to evaluate exits on
   * positions that were just closed.
   */
  clearActivePositions: () => void;
}

export type CommandResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Kill switch handler.
 *
 * Steps:
 *   1. Fetch actual open positions from Hyperliquid (not the bot's in-memory
 *      list, in case the bot was restarted and lost internal state).
 *   2. For each open position, call `closePosition(direction)` to submit a
 *      reduce-only IOC market order. Skipped entirely in DRY_RUN.
 *   3. Clear the bot's in-memory activePositions[] via the ctx callback.
 *   4. Flip the risk state `killed` flag so subsequent canTrade() calls and
 *      the runLoop gate both short-circuit.
 *
 * Stop-loss cleanup: handled automatically by `closePosition`, which now
 * scrubs any resting reduce-only BTC orders after each close (see
 * cancelOpenBtcStops in orders.ts). Kill switch inherits that behavior.
 */
export async function handleKillSwitch(
  payload: unknown,
  ctx: CommandHandlerContext
): Promise<CommandResult> {
  const reason =
    typeof payload === "object" &&
    payload !== null &&
    "reason" in payload &&
    typeof (payload as { reason?: unknown }).reason === "string"
      ? (payload as { reason: string }).reason
      : "Manual kill switch";

  console.warn(`[Commands] KILL SWITCH activated — reason: ${reason}`);

  const closedPositions: Array<{
    coin: string;
    direction: "long" | "short";
    size: number;
    oid: string | null;
    error?: string;
  }> = [];

  try {
    if (DRY_RUN) {
      console.warn("[Commands] DRY_RUN — skipping Hyperliquid close calls");
    } else {
      const open = await getOpenPositions();
      for (const pos of open) {
        if (pos.sizeBase === 0) continue;
        try {
          const oid = await closePosition(pos.direction);
          closedPositions.push({
            coin: pos.coin,
            direction: pos.direction,
            size: pos.sizeBase,
            oid: oid || null,
          });
          console.warn(
            `[Commands] Closed ${pos.coin} ${pos.direction} ${pos.sizeBase} (oid: ${oid || "n/a"})`
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          closedPositions.push({
            coin: pos.coin,
            direction: pos.direction,
            size: pos.sizeBase,
            oid: null,
            error: msg,
          });
          console.error(
            `[Commands] Failed to close ${pos.coin} ${pos.direction}: ${msg}`
          );
        }
      }
    }

    // Clear local tracking regardless of close success — if a close failed,
    // the next loop tick's position sync will surface it anyway, and we
    // don't want to re-attempt exits on positions we thought we closed.
    ctx.clearActivePositions();

    // Flip the gate AFTER closing so in-flight operations aren't interrupted
    // mid-call by a canTrade() short-circuit.
    setKilled(reason);

    // Write an immediate risk snapshot so the dashboard reflects the killed
    // state within seconds of the button click, instead of waiting up to
    // 15 min for the next natural tick. Non-fatal if it fails.
    await writeRiskSnapshot({ state: getState() });

    const anyErrors = closedPositions.some((p) => p.error);
    if (anyErrors) {
      return {
        ok: false,
        error: `Some close calls failed: ${closedPositions
          .filter((p) => p.error)
          .map((p) => `${p.direction}:${p.error}`)
          .join("; ")}`,
      };
    }
    return {
      ok: true,
      result: {
        reason,
        dryRun: DRY_RUN,
        closedPositions,
        killedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Commands] Kill switch error: ${msg}`);
    // Still flip the killed flag on a partial failure — the intent was clear
    // and the dashboard needs to reflect the killed state even if the
    // close-all step failed. Operator can inspect and retry manually.
    setKilled(`${reason} (handler error: ${msg})`);
    return { ok: false, error: msg };
  }
}

/**
 * Resume handler — clears the kill switch flag so the runLoop resumes
 * normal strategy evaluation on the next tick. Does NOT re-open any
 * positions that the kill switch closed.
 */
export async function handleResume(
  _payload: unknown,
  _ctx: CommandHandlerContext
): Promise<CommandResult> {
  clearKilled();
  // Same rationale as handleKillSwitch — push an immediate risk snapshot so
  // the dashboard banner clears within seconds of the Resume button click.
  await writeRiskSnapshot({ state: getState() });
  console.warn("[Commands] RESUME — kill switch cleared");
  return {
    ok: true,
    result: {
      resumedAt: new Date().toISOString(),
    },
  };
}
