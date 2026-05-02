/**
 * Hyperliquid order execution
 *
 * Exposes:
 *   placeMarketOrder  — S1 and S3 entries (IOC limit at ±5% slippage cap)
 *   placeLimitOrder   — S2 entries (GTC limit at EMA55)
 *   closePosition     — Exit any open BTC position at market (reduce-only)
 *   setStopLoss       — Place a trigger stop-market order after entry
 *
 * Notes on Hyperliquid order semantics:
 *   - Hyperliquid has no native market order. A "market order" is an IOC limit
 *     with a slippage-protected price (5% above mark for buys, 5% below for sells).
 *   - Sizes are strings, rounded to the asset's szDecimals.
 *   - Prices are strings with at most 5 significant figures AND <= MAX_DECIMALS - szDecimals
 *     decimal places. For BTC (szDecimals=5) on perps, that's up to 1 decimal place.
 *   - Leverage is set per-asset on the account via updateLeverage. We update it
 *     before placing the order if the requested leverage differs.
 */

import { getHyperliquidContext } from "./client";

export type OrderDirection = "long" | "short";

const MARKET_SLIPPAGE_BPS = 500; // 5% slippage cap on market orders
const PERP_MAX_DECIMALS = 6;     // perp price max decimals (per Hyperliquid docs)

let lastSetLeverage: number | null = null;

/** Round size to the asset's szDecimals. */
function roundSize(sizeBase: number, szDecimals: number): string {
  const factor = Math.pow(10, szDecimals);
  return (Math.floor(sizeBase * factor + 1e-9) / factor).toFixed(szDecimals);
}

/**
 * Round a price to Hyperliquid's allowed precision:
 * - Max 5 significant figures
 * - Max (MAX_DECIMALS - szDecimals) decimal places for perps
 * Source: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-size-and-lot-size
 */
function roundPrice(price: number, szDecimals: number): string {
  const maxDecimals = Math.max(0, PERP_MAX_DECIMALS - szDecimals);
  // First clamp decimal places, then enforce 5 significant figures.
  let p = Number(price.toFixed(maxDecimals));
  const sigFigs = 5;
  if (p > 0) {
    const exp = Math.floor(Math.log10(p));
    const factor = Math.pow(10, sigFigs - 1 - exp);
    p = Math.round(p * factor) / factor;
  }
  // Re-clamp decimals after sig-fig rounding.
  return Number(p.toFixed(maxDecimals)).toString();
}

/** Fetch the current BTC mark price from metaAndAssetCtxs. */
async function getBtcMarkPrice(): Promise<number> {
  const ctx = await getHyperliquidContext();
  const [, ctxs] = await ctx.info.metaAndAssetCtxs();
  return parseFloat(ctxs[ctx.btcAssetIndex].markPx);
}

/** Update account leverage on BTC if it differs from the cached value. */
async function ensureLeverage(leverage: number): Promise<void> {
  if (lastSetLeverage === leverage) return;
  const ctx = await getHyperliquidContext();
  await ctx.exchange.updateLeverage({
    asset: ctx.btcAssetIndex,
    isCross: false,
    leverage,
  });
  lastSetLeverage = leverage;
  console.log(`[Orders] Leverage set to ${leverage}x isolated on BTC`);
}

/**
 * Places a "market" order on BTC-PERP — implemented as IOC limit at ±5% slippage.
 *
 * @param direction   "long" | "short"
 * @param sizeBase    Position size in BTC (e.g. 0.01 = 0.01 BTC)
 * @param leverage    Leverage to use (1-40x on Hyperliquid for BTC)
 * @returns The order ID (oid) as a string
 */
export async function placeMarketOrder(
  direction: OrderDirection,
  sizeBase: number,
  leverage: number
): Promise<string> {
  const ctx = await getHyperliquidContext();
  await ensureLeverage(leverage);

  const markPx = await getBtcMarkPrice();
  const slippage = MARKET_SLIPPAGE_BPS / 10000;
  const limitPx =
    direction === "long" ? markPx * (1 + slippage) : markPx * (1 - slippage);

  const order = {
    a: ctx.btcAssetIndex,
    b: direction === "long",
    p: roundPrice(limitPx, ctx.btcSzDecimals),
    s: roundSize(sizeBase, ctx.btcSzDecimals),
    r: false,
    t: { limit: { tif: "Ioc" as const } },
  };

  const result = await ctx.exchange.order({ orders: [order], grouping: "na" });
  const status = result.response.data.statuses[0];

  if ("error" in status) {
    throw new Error(`[Orders] Market order rejected: ${status.error}`);
  }

  const oid =
    "filled" in status
      ? String(status.filled.oid)
      : "resting" in status
      ? String(status.resting.oid)
      : "unknown";

  console.log(
    `[Orders] Market ${direction} ${order.s} BTC @ ~$${markPx.toFixed(2)} ` +
      `(IOC cap $${order.p}), ${leverage}x | oid: ${oid}`
  );
  return oid;
}

/**
 * Places a GTC limit order on BTC-PERP (used for S2 EMA55 retest entries).
 */
export async function placeLimitOrder(
  direction: OrderDirection,
  sizeBase: number,
  limitPrice: number,
  leverage: number
): Promise<string> {
  const ctx = await getHyperliquidContext();
  await ensureLeverage(leverage);

  // S2 long: shave 0.05% off the limit per the KB so we get a maker fill at
  // the EMA55 retest rather than crossing the spread.
  const adjusted =
    direction === "long" ? limitPrice * 0.9995 : limitPrice * 1.0005;

  const order = {
    a: ctx.btcAssetIndex,
    b: direction === "long",
    p: roundPrice(adjusted, ctx.btcSzDecimals),
    s: roundSize(sizeBase, ctx.btcSzDecimals),
    r: false,
    t: { limit: { tif: "Gtc" as const } },
  };

  const result = await ctx.exchange.order({ orders: [order], grouping: "na" });
  const status = result.response.data.statuses[0];

  if ("error" in status) {
    throw new Error(`[Orders] Limit order rejected: ${status.error}`);
  }

  const oid =
    "resting" in status
      ? String(status.resting.oid)
      : "filled" in status
      ? String(status.filled.oid)
      : "unknown";

  console.log(
    `[Orders] Limit ${direction} ${order.s} BTC @ $${order.p}, ${leverage}x | oid: ${oid}`
  );
  return oid;
}

/**
 * Closes the entire BTC-PERP position at market (reduce-only IOC).
 *
 * After a successful close (or on the empty-position early return), this
 * also scrubs any resting reduce-only BTC orders from the book via
 * `cancelOpenBtcStops`. This is defensive cleanup so orphaned stop-losses
 * don't accumulate across trades. Cleanup failure is logged but does NOT
 * throw — a successful close must not be masked by a cleanup failure.
 */
export async function closePosition(direction: OrderDirection, skipStopCleanup = false): Promise<string> {
  const ctx = await getHyperliquidContext();
  const state = await ctx.info.clearinghouseState({ user: ctx.masterAddress });
  const btcPos = state.assetPositions.find((p) => p.position.coin === "BTC");

  if (!btcPos || parseFloat(btcPos.position.szi) === 0) {
    console.log("[Orders] No open BTC position to close");
    if (!skipStopCleanup) {
      try {
        await cancelOpenBtcStops();
      } catch (err) {
        console.warn("[Orders] Stop cleanup failed on empty-position path:", err);
      }
    }
    return "";
  }

  const sizeBase = Math.abs(parseFloat(btcPos.position.szi));
  const closeIsLong = direction === "short"; // close a short by buying
  const markPx = await getBtcMarkPrice();
  const slippage = MARKET_SLIPPAGE_BPS / 10000;
  const limitPx =
    closeIsLong ? markPx * (1 + slippage) : markPx * (1 - slippage);

  const order = {
    a: ctx.btcAssetIndex,
    b: closeIsLong,
    p: roundPrice(limitPx, ctx.btcSzDecimals),
    s: roundSize(sizeBase, ctx.btcSzDecimals),
    r: true, // reduce-only
    t: { limit: { tif: "Ioc" as const } },
  };

  const result = await ctx.exchange.order({ orders: [order], grouping: "na" });
  const status = result.response.data.statuses[0];

  if ("error" in status) {
    throw new Error(`[Orders] Close rejected: ${status.error}`);
  }

  const oid =
    "filled" in status
      ? String(status.filled.oid)
      : "resting" in status
      ? String(status.resting.oid)
      : "unknown";

  console.log(`[Orders] Closed ${direction} ${order.s} BTC | oid: ${oid}`);

  if (!skipStopCleanup) {
    try {
      await cancelOpenBtcStops();
    } catch (err) {
      console.warn("[Orders] Stop cleanup failed after close:", err);
    }
  }

  return oid;
}

/**
 * Cancels an open order by its order ID.
 * Used to clean up stop-loss orders when a position is closed manually
 * (so we don't leave orphaned reduce-only orders sitting on the book).
 */
export async function cancelOrder(oid: string): Promise<void> {
  const ctx = await getHyperliquidContext();
  await ctx.exchange.cancel({
    cancels: [{ a: ctx.btcAssetIndex, o: parseInt(oid, 10) }],
  });
  console.log(`[Orders] Canceled order ${oid}`);
}

/**
 * Cancels any resting reduce-only BTC orders (stop-losses placed via
 * setStopLoss). Called automatically from closePosition as cleanup so
 * orphaned triggers don't pile up on the book across many trades.
 *
 * Filter is `coin === "BTC" && reduceOnly === true`:
 *   - Entry limits (placeLimitOrder) have reduceOnly=false → untouched
 *   - Stop-losses (setStopLoss) have reduceOnly=true → canceled
 *   - Anything on another asset → untouched (BTC-only bot for now)
 *
 * Safe to call when there are no matching orders — it's a no-op.
 * Returns the number of orders canceled.
 */
export async function cancelOpenBtcStops(): Promise<number> {
  const ctx = await getHyperliquidContext();
  const open = await ctx.info.openOrders({ user: ctx.masterAddress });
  const stops = open.filter(
    (o: { coin?: string; reduceOnly?: boolean; oid: number }) =>
      o.coin === "BTC" && o.reduceOnly === true
  );
  if (stops.length === 0) return 0;

  await ctx.exchange.cancel({
    cancels: stops.map((o: { oid: number }) => ({ a: ctx.btcAssetIndex, o: o.oid })),
  });
  console.log(
    `[Orders] Canceled ${stops.length} orphaned reduce-only BTC order(s): ` +
      stops.map((o: { oid: number }) => o.oid).join(", ")
  );
  return stops.length;
}

/**
 * Places a trigger take-profit (TP) order after entry.
 * Uses Hyperliquid's native trigger order type with `tpsl: "tp"`.
 *
 * For a long position the TP triggers when price rises above triggerPx.
 * For a short position the TP triggers when price drops below triggerPx.
 */
export async function setTakeProfit(
  direction: OrderDirection,
  tpPrice: number,
  sizeBase: number
): Promise<string> {
  const ctx = await getHyperliquidContext();
  // To TP a long, we sell (b=false). To TP a short, we buy (b=true).
  const closeIsLong = direction === "short";

  const order = {
    a: ctx.btcAssetIndex,
    b: closeIsLong,
    p: roundPrice(tpPrice, ctx.btcSzDecimals),
    s: roundSize(sizeBase, ctx.btcSzDecimals),
    r: true, // reduce-only
    t: {
      trigger: {
        isMarket: true,
        triggerPx: roundPrice(tpPrice, ctx.btcSzDecimals),
        tpsl: "tp" as const,
      },
    },
  };

  const result = await ctx.exchange.order({ orders: [order], grouping: "na" });
  const status = result.response.data.statuses[0];

  if ("error" in status) {
    throw new Error(`[Orders] Take-profit rejected: ${status.error}`);
  }

  const oid =
    "resting" in status
      ? String(status.resting.oid)
      : "filled" in status
      ? String(status.filled.oid)
      : "unknown";

  console.log(`[Orders] Take-profit set @ $${tpPrice} (${order.s} BTC) | oid: ${oid}`);
  return oid;
}

/**
 * Scaled take-profit target definition.
 * @param pct      Distance from entry as a fraction (e.g. 0.01 = 1%)
 * @param portion  Fraction of the total position to close (e.g. 0.5 = 50%)
 */
export interface TakeProfitTarget {
  pct: number;
  portion: number;
}

/**
 * Places multiple take-profit trigger orders at scaled price levels.
 *
 * Each target closes a portion of the position at a different distance from
 * entry. For example:
 *   [{ pct: 0.01, portion: 0.5 }, { pct: 0.015, portion: 0.25 }, { pct: 0.02, portion: 0.25 }]
 * closes 50% at +1%, 25% at +1.5%, 25% at +2%.
 *
 * @returns Array of { price, size, oid } for each target placed.
 */
export async function setScaledTakeProfits(
  direction: OrderDirection,
  entryPrice: number,
  totalSizeBase: number,
  targets: TakeProfitTarget[]
): Promise<Array<{ price: number; size: number; oid: string }>> {
  const ctx = await getHyperliquidContext();
  const results: Array<{ price: number; size: number; oid: string }> = [];

  for (let i = 0; i < targets.length; i++) {
    const { pct, portion } = targets[i];
    const tpPrice =
      direction === "long"
        ? entryPrice * (1 + pct)
        : entryPrice * (1 - pct);

    // For the last target, use remaining size to avoid rounding dust
    let targetSize: number;
    if (i === targets.length - 1) {
      const alreadyAllocated = results.reduce((sum, r) => sum + r.size, 0);
      targetSize = totalSizeBase - alreadyAllocated;
    } else {
      targetSize = totalSizeBase * portion;
    }

    // Floor to szDecimals — skip if rounds to zero
    const sizeStr = roundSize(targetSize, ctx.btcSzDecimals);
    if (parseFloat(sizeStr) === 0) {
      console.warn(`[Orders] TP${i + 1} size rounds to 0 — skipping`);
      continue;
    }

    const oid = await setTakeProfit(direction, tpPrice, parseFloat(sizeStr));
    results.push({ price: tpPrice, size: parseFloat(sizeStr), oid });
    console.log(
      `[Orders] TP${i + 1}: ${(portion * 100).toFixed(0)}% (${sizeStr} BTC) @ $${tpPrice.toFixed(2)} | oid: ${oid}`
    );
  }

  return results;
}

/**
 * Places a trigger-stop (stop-market) order after entry.
 * Uses Hyperliquid's native trigger order type with `tpsl: "sl"`.
 */
export async function setStopLoss(
  direction: OrderDirection,
  stopPrice: number,
  sizeBase: number
): Promise<string> {
  const ctx = await getHyperliquidContext();
  // To stop-out a long, we need a sell-stop (b=false). For a short, a buy-stop.
  const closeIsLong = direction === "short";

  const order = {
    a: ctx.btcAssetIndex,
    b: closeIsLong,
    p: roundPrice(stopPrice, ctx.btcSzDecimals),
    s: roundSize(sizeBase, ctx.btcSzDecimals),
    r: true, // reduce-only
    t: {
      trigger: {
        isMarket: true,
        triggerPx: roundPrice(stopPrice, ctx.btcSzDecimals),
        tpsl: "sl" as const,
      },
    },
  };

  const result = await ctx.exchange.order({ orders: [order], grouping: "na" });
  const status = result.response.data.statuses[0];

  if ("error" in status) {
    throw new Error(`[Orders] Stop-loss rejected: ${status.error}`);
  }

  const oid =
    "resting" in status
      ? String(status.resting.oid)
      : "filled" in status
      ? String(status.filled.oid)
      : "unknown";

  console.log(`[Orders] Stop-loss set @ $${stopPrice} (${order.s} BTC) | oid: ${oid}`);
  return oid;
}
