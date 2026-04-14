/**
 * Hyperliquid account queries
 *
 * Exposes:
 *   getBalance        — USDC withdrawable margin (free collateral) on Hyperliquid
 *   getOpenPositions  — Active BTC perp positions on the master account
 *   getFundingRate    — Current hourly BTC-PERP funding rate (decimal)
 *
 * All queries hit the InfoClient (read-only, no signing required).
 */

import { getHyperliquidContext } from "./client";

export interface PositionInfo {
  coin: string;
  direction: "long" | "short";
  sizeBase: number;
  entryPrice: number;
  unrealizedPnl: number;
}

/**
 * Returns the free USDC margin available for new trades on Hyperliquid.
 * Uses `withdrawable` from clearinghouseState — this is the conservative,
 * post-margin-deduction value (what the account could withdraw right now).
 */
export async function getBalance(): Promise<number> {
  const ctx = await getHyperliquidContext();
  const state = await ctx.info.clearinghouseState({ user: ctx.masterAddress });
  return parseFloat(state.withdrawable);
}

/**
 * Returns all currently open BTC perp positions on the master account.
 */
export async function getOpenPositions(): Promise<PositionInfo[]> {
  const ctx = await getHyperliquidContext();
  const state = await ctx.info.clearinghouseState({ user: ctx.masterAddress });

  return state.assetPositions
    .filter((p) => p.position.coin === "BTC")
    .map((p) => {
      const szi = parseFloat(p.position.szi);
      return {
        coin: p.position.coin,
        direction: szi >= 0 ? ("long" as const) : ("short" as const),
        sizeBase: Math.abs(szi),
        entryPrice: parseFloat(p.position.entryPx),
        unrealizedPnl: parseFloat(p.position.unrealizedPnl),
      };
    });
}

/**
 * Returns the current hourly funding rate for BTC-PERP as a decimal.
 * Positive = longs pay shorts. Negative = shorts pay longs.
 */
export async function getFundingRate(): Promise<number> {
  const ctx = await getHyperliquidContext();
  const [, ctxs] = await ctx.info.metaAndAssetCtxs();
  const btcCtx = ctxs[ctx.btcAssetIndex];
  return parseFloat(btcCtx.funding);
}

// ---------------------------------------------------------------------------
// User fills — for detecting native TP/SL closes
// ---------------------------------------------------------------------------

export interface FillInfo {
  coin: string;
  side: "B" | "A"; // B = buy, A = sell (ask)
  price: number;
  size: number;
  time: number; // epoch ms
  closedPnl: number;
  fee: number;
  oid: number;
}

/**
 * Returns recent BTC fills for the master account within a time window.
 * Used by the reconciliation loop to find the actual exit price when a
 * native TP/SL fires on Hyperliquid.
 *
 * @param sinceMs - Epoch ms to start from (default: last 4 hours)
 */
export async function getUserFills(sinceMs?: number): Promise<FillInfo[]> {
  const ctx = await getHyperliquidContext();
  const startTime = sinceMs ?? Date.now() - 4 * 60 * 60 * 1000;
  const response = await ctx.info.userFillsByTime({
    user: ctx.masterAddress,
    startTime,
  });

  return (response as unknown as Array<Record<string, unknown>>)
    .filter((f) => f.coin === "BTC")
    .map((f) => ({
      coin:     f.coin as string,
      side:     f.side as "B" | "A",
      price:    parseFloat(f.px as string),
      size:     parseFloat(f.sz as string),
      time:     f.time as number,
      closedPnl: parseFloat(f.closedPnl as string),
      fee:      parseFloat(f.fee as string),
      oid:      f.oid as number,
    }));
}
