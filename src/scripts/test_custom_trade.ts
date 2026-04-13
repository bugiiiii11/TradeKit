/**
 * Custom trade test — places a BTC position with stop-loss and scaled
 * take-profit levels, then monitors until fully closed or timeout.
 *
 * Usage:
 *   npx ts-node src/scripts/test_custom_trade.ts long 5 1 1,1.5,2 60
 *   npx ts-node src/scripts/test_custom_trade.ts short 3 2 1,2,3 40
 *
 * Args: <direction> <leverage> <sl_pct> <tp_levels> <notional_usd>
 *   direction    — "long" or "short" (default: long)
 *   leverage     — leverage multiplier (default: 3)
 *   sl_pct       — stop-loss distance in % (default: 1)
 *   tp_levels    — comma-separated TP distances in % (default: "1")
 *                  1 level  → 100% close at TP1
 *                  2 levels → 50%/50%
 *                  3 levels → 50%/25%/25%
 *   notional_usd — position size in USD (default: 20)
 *
 * Monitors every 10s and auto-closes after 30 minutes if not fully closed.
 *
 * Run with: npx ts-node src/scripts/test_custom_trade.ts [long|short] [leverage] [sl%] [tp1,tp2,tp3] [notional]
 */

import "dotenv/config";
import { getHyperliquidContext } from "../hyperliquid/client";
import { getBalance, getOpenPositions } from "../hyperliquid/account";
import {
  placeMarketOrder,
  closePosition,
  setStopLoss,
  setTakeProfit,
  setScaledTakeProfits,
  type OrderDirection,
  type TakeProfitTarget,
} from "../hyperliquid/orders";
import { insertClosedTrade } from "../db/trades";

// --- CLI args ---
const DIRECTION: OrderDirection = (() => {
  const arg = (process.argv[2] ?? "long").toLowerCase();
  if (arg !== "long" && arg !== "short") {
    throw new Error(`Invalid direction "${arg}" — must be "long" or "short"`);
  }
  return arg;
})();
const LEVERAGE = parseFloat(process.argv[3] ?? "3");
const SL_PCT = parseFloat(process.argv[4] ?? "1") / 100;

// Parse TP levels: "1" → single TP at 1%, "1,1.5,2" → scaled 50%/25%/25%
const TP_LEVELS: TakeProfitTarget[] = (() => {
  const raw = (process.argv[5] ?? "1").split(",").map((s) => parseFloat(s.trim()) / 100);
  if (raw.length === 1) {
    return [{ pct: raw[0], portion: 1.0 }];
  } else if (raw.length === 2) {
    return [
      { pct: raw[0], portion: 0.5 },
      { pct: raw[1], portion: 0.5 },
    ];
  } else {
    // 3+ levels: 50% / 25% / 25% (last level gets remainder)
    return [
      { pct: raw[0], portion: 0.5 },
      { pct: raw[1], portion: 0.25 },
      ...raw.slice(2).map((pct, i, arr) => ({
        pct,
        portion: i === arr.length - 1 ? 0.25 : 0.25 / arr.length,
      })),
    ];
  }
})();

const TARGET_NOTIONAL_USD = parseFloat(process.argv[6] ?? "20");
const MIN_ORDER_USD = 10;
const MONITOR_INTERVAL_MS = 10_000;
const MAX_HOLD_MS = 30 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function floorTo(value: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.floor(value * f) / f;
}

async function main(): Promise<void> {
  const tpDesc = TP_LEVELS.map(
    (t, i) => `TP${i + 1}: ${(t.pct * 100).toFixed(1)}% (${(t.portion * 100).toFixed(0)}%)`
  ).join(", ");

  console.log("=== CUSTOM TRADE TEST ===");
  console.log(`Direction: ${DIRECTION} | Leverage: ${LEVERAGE}x | SL: ${(SL_PCT * 100).toFixed(1)}%`);
  console.log(`Take-profits: ${tpDesc}`);
  console.log(`Notional: ~$${TARGET_NOTIONAL_USD} | Timeout: ${MAX_HOLD_MS / 60000} min\n`);

  // 1. Connect & show starting balance
  console.log("[1/5] Connecting to Hyperliquid...");
  const ctx = await getHyperliquidContext();
  const balanceBefore = await getBalance();
  console.log(`  Balance: $${balanceBefore.toFixed(4)}\n`);

  // 2. Get mark price and calculate size
  console.log("[2/5] Fetching BTC mark price...");
  const [, ctxs] = await ctx.info.metaAndAssetCtxs();
  const markPx = parseFloat(ctxs[ctx.btcAssetIndex].markPx);
  console.log(`  BTC mark: $${markPx.toFixed(2)}`);

  const rawSize = TARGET_NOTIONAL_USD / markPx;
  const sizeBase = floorTo(rawSize, ctx.btcSzDecimals);
  const actualNotional = sizeBase * markPx;
  console.log(`  Size: ${sizeBase} BTC (~$${actualNotional.toFixed(2)} notional)\n`);

  if (actualNotional < MIN_ORDER_USD) {
    throw new Error(`Size too small: $${actualNotional.toFixed(2)} < min $${MIN_ORDER_USD}`);
  }

  // Pre-check: verify each TP slice meets Hyperliquid's $10 minimum
  if (TP_LEVELS.length > 1) {
    const smallestPortion = Math.min(...TP_LEVELS.map((t) => t.portion));
    const smallestSliceUsd = actualNotional * smallestPortion;
    if (smallestSliceUsd < MIN_ORDER_USD) {
      const needed = Math.ceil(MIN_ORDER_USD / smallestPortion);
      throw new Error(
        `Smallest TP slice is $${smallestSliceUsd.toFixed(2)} (${(smallestPortion * 100).toFixed(0)}% of $${actualNotional.toFixed(2)}) — ` +
          `below Hyperliquid's $${MIN_ORDER_USD} minimum. Use at least $${needed} notional.`
      );
    }
  }

  // 3. Place market order
  console.log(`[3/5] Placing MARKET ${DIRECTION.toUpperCase()} @ ${LEVERAGE}x...`);
  const entryOid = await placeMarketOrder(DIRECTION, sizeBase, LEVERAGE);
  console.log(`  Entry oid: ${entryOid}`);

  await sleep(3000);
  const positions = await getOpenPositions();
  const btcPos = positions.find((p) => p.coin === "BTC");
  if (!btcPos) {
    throw new Error("No BTC position found after entry — check Hyperliquid UI");
  }
  const entryPrice = btcPos.entryPrice;
  console.log(`  Position open: ${btcPos.direction} ${btcPos.sizeBase} BTC @ $${entryPrice.toFixed(2)}\n`);

  // 4. Place SL and scaled TPs
  console.log("[4/5] Setting stop-loss and take-profit(s)...");
  const slPrice = DIRECTION === "long"
    ? entryPrice * (1 - SL_PCT)
    : entryPrice * (1 + SL_PCT);

  const slOid = await setStopLoss(DIRECTION, slPrice, sizeBase);
  console.log(`  SL @ $${slPrice.toFixed(2)} (oid: ${slOid})`);

  if (TP_LEVELS.length === 1) {
    const tpPrice = DIRECTION === "long"
      ? entryPrice * (1 + TP_LEVELS[0].pct)
      : entryPrice * (1 - TP_LEVELS[0].pct);
    const tpOid = await setTakeProfit(DIRECTION, tpPrice, sizeBase);
    console.log(`  TP @ $${tpPrice.toFixed(2)} (oid: ${tpOid})\n`);
  } else {
    const tpResults = await setScaledTakeProfits(DIRECTION, entryPrice, sizeBase, TP_LEVELS);
    for (let i = 0; i < tpResults.length; i++) {
      const r = tpResults[i];
      console.log(`  TP${i + 1} @ $${r.price.toFixed(2)} — ${r.size} BTC (oid: ${r.oid})`);
    }
    console.log();
  }

  // 5. Monitor until position fully closes or timeout
  console.log("[5/5] Monitoring position (Ctrl+C to force close)...");
  console.log(`  Entry: $${entryPrice.toFixed(2)} | SL: $${slPrice.toFixed(2)}`);
  console.log(`  ${tpDesc}\n`);

  const startTime = Date.now();
  let exitReason = "timeout";
  let lastSize = sizeBase;

  let interrupted = false;
  const onSigint = () => { interrupted = true; };
  process.once("SIGINT", onSigint);

  while (Date.now() - startTime < MAX_HOLD_MS && !interrupted) {
    await sleep(MONITOR_INTERVAL_MS);

    const current = await getOpenPositions();
    const pos = current.find((p) => p.coin === "BTC");

    if (!pos || parseFloat(String(pos.sizeBase)) === 0) {
      exitReason = "fully_closed";
      console.log("  Position fully closed (SL or final TP triggered)!");
      break;
    }

    const currentSize = pos.sizeBase;
    if (currentSize < lastSize) {
      console.log(`  ** Partial TP hit! Size reduced: ${lastSize} → ${currentSize} BTC`);
      lastSize = currentSize;
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const pnlPct = ((pos.unrealizedPnl / actualNotional) * 100).toFixed(3);
    console.log(
      `  [${elapsed}s] Size: ${currentSize} BTC | ` +
        `uPnL: $${pos.unrealizedPnl.toFixed(4)} (${pnlPct}%)`
    );
  }

  // If timed out or Ctrl+C, close remaining position
  if (exitReason === "timeout" || interrupted) {
    const reason = interrupted ? "user interrupted (Ctrl+C)" : "timeout (30 min)";
    console.log(`\n  Closing remaining position — ${reason}...`);
    await closePosition(DIRECTION);
    exitReason = interrupted ? "manual" : "timeout";
    await sleep(3000);
  }

  // Final balance
  const balanceAfter = await getBalance();
  const pnl = balanceAfter - balanceBefore;

  console.log(`\n=== RESULT ===`);
  console.log(`Exit reason:    ${exitReason}`);
  console.log(`Balance before: $${balanceBefore.toFixed(4)}`);
  console.log(`Balance after:  $${balanceAfter.toFixed(4)}`);
  console.log(`Net PnL:        ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(4)}`);

  // Write to Supabase trades table as "manual" source
  const exitTime = new Date().toISOString();
  const riskDollar = actualNotional * SL_PCT; // approximate risk = notional × SL%
  try {
    await insertClosedTrade({
      strategy: "S3" as const, // placeholder — manual trades aren't strategy-driven
      direction: DIRECTION,
      symbol: "BTC",
      size: sizeBase,
      entryPrice,
      exitPrice: entryPrice + pnl / sizeBase, // back-calculate from realized PnL
      entryTime: new Date(startTime - 3000).toISOString(), // approximate entry time
      exitTime,
      pnlUsd: pnl,
      riskDollar,
      leverage: LEVERAGE,
      confluenceScore: 0,
      stopDistancePct: SL_PCT,
      exitReason,
      source: "manual",
    });
    console.log("[Supabase] Manual trade logged to trades table");
  } catch (err) {
    console.warn("[Supabase] Failed to log trade:", err);
  }

  console.log(`\nDone.`);

  process.removeListener("SIGINT", onSigint);
}

main().catch((err) => {
  console.error("\nFAILED:", err.message ?? err);
  console.error("\nIMPORTANT: If a position was opened, check app.hyperliquid.xyz");
  console.error("and manually close any open BTC position + cancel resting orders.");
  process.exit(1);
});
