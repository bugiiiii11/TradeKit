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
import { closePosition, placeMarketOrder, setStopLoss, setTakeProfit, type OrderDirection } from "../hyperliquid/orders";
import { getHyperliquidContext } from "../hyperliquid/client";
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
 * Manual trade handler.
 *
 * Payload shape (ManualTradePayload):
 *   direction    — "long" | "short"
 *   leverage     — 1–40
 *   notionalUsd  — position size in USD (≥ $10)
 *   slPrice      — absolute stop-loss price
 *   tpTargets    — 1–3 take-profit levels: { price, portion }
 *                  portion is a fraction of total size (must sum to ≈ 1.0)
 *
 * Steps:
 *   1. Validate payload and bot state (killed check, existing position check).
 *   2. Fetch mark price → calculate BTC size from notional.
 *   3. Place market order (IOC via placeMarketOrder).
 *   4. Wait 3 s for fill confirmation, then verify position exists.
 *   5. Set stop-loss at slPrice.
 *   6. Set each TP level via setTakeProfit (last level gets remaining size
 *      to avoid rounding dust).
 *   7. Return full result including entryPrice, oids, and tpCount.
 */
export interface ManualTradePayload {
  direction: "long" | "short";
  leverage: number;
  notionalUsd: number;
  slPrice: number;
  tpTargets: Array<{ price: number; portion: number }>;
}

export async function handleManualTrade(
  payload: unknown,
  _ctx: CommandHandlerContext
): Promise<CommandResult> {
  if (typeof payload !== "object" || !payload) {
    return { ok: false, error: "Invalid payload: expected object" };
  }
  const p = payload as ManualTradePayload;
  const { direction, leverage, notionalUsd, slPrice, tpTargets } = p;

  if (direction !== "long" && direction !== "short") {
    return { ok: false, error: `Invalid direction: ${String(direction)}` };
  }
  if (!leverage || leverage < 1 || leverage > 40) {
    return { ok: false, error: `Leverage must be 1–40, got: ${leverage}` };
  }
  if (!notionalUsd || notionalUsd < 10) {
    return { ok: false, error: `Notional must be ≥ $10, got: $${notionalUsd}` };
  }
  if (!slPrice || slPrice <= 0) {
    return { ok: false, error: `Invalid SL price: ${slPrice}` };
  }
  if (!Array.isArray(tpTargets) || tpTargets.length === 0) {
    return { ok: false, error: "At least one TP target is required" };
  }
  if (tpTargets.length > 3) {
    return { ok: false, error: "Maximum 3 TP targets allowed" };
  }

  if (getState().killed) {
    return { ok: false, error: "Bot is in killed state — resume before placing trades" };
  }

  console.log(
    `[Commands] Manual trade: ${direction} ${leverage}x $${notionalUsd} | ` +
      `SL: $${slPrice} | TPs: ${tpTargets.length}`
  );

  if (DRY_RUN) {
    console.warn("[Commands] DRY_RUN — skipping Hyperliquid order calls");
    return {
      ok: true,
      result: {
        dryRun: true,
        direction,
        leverage,
        notionalUsd,
        slPrice,
        tpCount: tpTargets.length,
      },
    };
  }

  try {
    // Block if there is already an open BTC position
    const open = await getOpenPositions();
    const existing = open.find((pos) => pos.coin === "BTC" && pos.sizeBase > 0);
    if (existing) {
      return {
        ok: false,
        error: `Already have an open BTC ${existing.direction} position (${existing.sizeBase} BTC). Close it first.`,
      };
    }

    // Get mark price and calculate BTC size
    const ctx = await getHyperliquidContext();
    const [, ctxs] = await ctx.info.metaAndAssetCtxs();
    const markPx = parseFloat(ctxs[ctx.btcAssetIndex].markPx);
    const factor = Math.pow(10, ctx.btcSzDecimals);
    const sizeBase = Math.floor((notionalUsd / markPx) * factor) / factor;

    if (sizeBase === 0) {
      return {
        ok: false,
        error: `Notional $${notionalUsd} too small for BTC @ $${markPx.toFixed(0)}`,
      };
    }

    // Server-side direction validation (belt-and-suspenders over client validation)
    if (direction === "long" && slPrice >= markPx) {
      return { ok: false, error: `Long SL ($${slPrice}) must be below mark ($${markPx.toFixed(0)})` };
    }
    if (direction === "short" && slPrice <= markPx) {
      return { ok: false, error: `Short SL ($${slPrice}) must be above mark ($${markPx.toFixed(0)})` };
    }
    for (let i = 0; i < tpTargets.length; i++) {
      const tpPrice = tpTargets[i].price;
      if (direction === "long" && tpPrice <= markPx) {
        return { ok: false, error: `TP${i + 1} ($${tpPrice}) must be above mark ($${markPx.toFixed(0)}) for a long` };
      }
      if (direction === "short" && tpPrice >= markPx) {
        return { ok: false, error: `TP${i + 1} ($${tpPrice}) must be below mark ($${markPx.toFixed(0)}) for a short` };
      }
    }

    // Place market entry
    const entryOid = await placeMarketOrder(direction as OrderDirection, sizeBase, leverage);

    // Wait for fill confirmation
    await new Promise<void>((resolve) => setTimeout(resolve, 3000));

    // Verify position exists
    const positions = await getOpenPositions();
    const btcPos = positions.find((pos) => pos.coin === "BTC");
    if (!btcPos) {
      return {
        ok: false,
        error: "No BTC position found after entry — check Hyperliquid UI and close manually if needed",
      };
    }
    const entryPrice = btcPos.entryPrice;

    // Set stop-loss
    const slOid = await setStopLoss(direction as OrderDirection, slPrice, sizeBase);

    // Set take-profit levels
    const tpOids: string[] = [];
    let allocatedSize = 0;

    for (let i = 0; i < tpTargets.length; i++) {
      const { price: tpPrice, portion } = tpTargets[i];
      let tpSize: number;

      if (i === tpTargets.length - 1) {
        // Last TP gets remaining size to avoid rounding dust
        tpSize = Math.floor((sizeBase - allocatedSize) * factor) / factor;
      } else {
        tpSize = Math.floor(sizeBase * portion * factor) / factor;
      }

      if (tpSize <= 0) {
        console.warn(`[Commands] TP${i + 1} size rounds to 0 — skipping`);
        continue;
      }

      const tpOid = await setTakeProfit(direction as OrderDirection, tpPrice, tpSize);
      tpOids.push(tpOid);
      allocatedSize += tpSize;
      console.log(
        `[Commands] TP${i + 1}: ${(portion * 100).toFixed(0)}% (${tpSize} BTC) @ $${tpPrice} | oid: ${tpOid}`
      );
    }

    return {
      ok: true,
      result: {
        direction,
        leverage,
        entryPrice,
        sizeBase,
        actualNotionalUsd: sizeBase * markPx,
        slPrice,
        entryOid,
        slOid,
        tpOids,
        tpCount: tpOids.length,
        placedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Commands] Manual trade error: ${msg}`);
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
