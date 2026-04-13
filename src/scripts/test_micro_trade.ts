/**
 * Micro-trade test — places a $20 BTC position, holds for 30 seconds, closes.
 *
 * Direction is a CLI argument: `long` (default) or `short`.
 *
 * Purpose: validate the order execution code path on real mainnet with
 * minimal risk. Tests:
 *   - placeMarketOrder (entry)
 *   - closePosition (exit)
 *
 * Stop-loss is intentionally NOT tested here to keep the script simple
 * and the moving parts minimal. setStopLoss can be validated separately.
 *
 * Worst-case loss: ~$1 (taker fee 0.043% × $20 × 2 sides + slippage).
 *
 * Run with: npx ts-node src/scripts/test_micro_trade.ts [long|short]
 */

import "dotenv/config";
import { getHyperliquidContext } from "../hyperliquid/client";
import { getBalance, getOpenPositions } from "../hyperliquid/account";
import { placeMarketOrder, closePosition, type OrderDirection } from "../hyperliquid/orders";

const DIRECTION: OrderDirection = (() => {
  const arg = (process.argv[2] ?? "long").toLowerCase();
  if (arg !== "long" && arg !== "short") {
    throw new Error(`Invalid direction "${arg}" — must be "long" or "short"`);
  }
  return arg;
})();

const TARGET_NOTIONAL_USD = 20;
const HOLD_DURATION_MS = 30_000;
const LEVERAGE = 1;
const MIN_ORDER_USD = 10; // Hyperliquid perp minimum

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function floorTo(value: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.floor(value * f) / f;
}

async function main(): Promise<void> {
  console.log("=== MICRO-TRADE TEST ===");
  console.log(`Target: $${TARGET_NOTIONAL_USD} BTC ${DIRECTION}, ${LEVERAGE}x, hold ${HOLD_DURATION_MS / 1000}s\n`);

  // 1. Connect & show starting balance
  console.log("[1/6] Connecting to Hyperliquid...");
  const ctx = await getHyperliquidContext();
  const balanceBefore = await getBalance();
  console.log(`  Balance before: $${balanceBefore.toFixed(4)}\n`);

  // 2. Get current BTC mark price
  console.log("[2/6] Fetching BTC mark price...");
  const [, ctxs] = await ctx.info.metaAndAssetCtxs();
  const markPx = parseFloat(ctxs[ctx.btcAssetIndex].markPx);
  console.log(`  BTC mark: $${markPx.toFixed(2)}\n`);

  // 3. Calculate size (rounded DOWN to szDecimals to stay within budget)
  const rawSize = TARGET_NOTIONAL_USD / markPx;
  const sizeBase = floorTo(rawSize, ctx.btcSzDecimals);
  const actualNotional = sizeBase * markPx;
  console.log(`[3/6] Calculated size: ${sizeBase} BTC (≈ $${actualNotional.toFixed(2)} notional)`);

  if (actualNotional < MIN_ORDER_USD) {
    throw new Error(
      `Size too small: $${actualNotional.toFixed(2)} < Hyperliquid min $${MIN_ORDER_USD}`
    );
  }
  if (sizeBase <= 0) {
    throw new Error(`Computed size is zero — check szDecimals (${ctx.btcSzDecimals})`);
  }

  // 4. Place market order
  console.log(`\n[4/6] Placing MARKET ${DIRECTION.toUpperCase()} order...`);
  const entryOid = await placeMarketOrder(DIRECTION, sizeBase, LEVERAGE);
  console.log(`  Order placed | oid: ${entryOid}`);

  // Wait briefly for fill, then verify
  await sleep(3000);
  const positions = await getOpenPositions();
  const btcPos = positions.find((p) => p.coin === "BTC");
  if (!btcPos) {
    throw new Error("No BTC position found after placing order — check Hyperliquid UI");
  }
  console.log(`  ✅ Position open: ${btcPos.direction} ${btcPos.sizeBase} BTC @ $${btcPos.entryPrice.toFixed(2)}`);
  console.log(`     Unrealized PnL: $${btcPos.unrealizedPnl.toFixed(4)}`);

  // 5. Hold for the configured duration
  console.log(`\n[5/6] Holding position for ${HOLD_DURATION_MS / 1000}s...`);
  await sleep(HOLD_DURATION_MS - 3000);

  const positionsMid = await getOpenPositions();
  const btcPosMid = positionsMid.find((p) => p.coin === "BTC");
  if (btcPosMid) {
    console.log(`  Mid-hold check: still open, unrealized PnL: $${btcPosMid.unrealizedPnl.toFixed(4)}`);
  }

  // 6. Close position at market
  console.log("\n[6/6] Closing position at market...");
  const closeOid = await closePosition(DIRECTION);
  console.log(`  Close order placed | oid: ${closeOid}`);

  // Wait a moment, then show final state
  await sleep(3000);
  const positionsAfter = await getOpenPositions();
  if (positionsAfter.length > 0) {
    console.log(`  ⚠️  Warning: ${positionsAfter.length} position(s) still open after close — check the UI`);
    for (const p of positionsAfter) {
      console.log(`     ${p.direction} ${p.sizeBase} BTC @ $${p.entryPrice.toFixed(2)}`);
    }
  } else {
    console.log("  ✅ Position fully closed");
  }

  const balanceAfter = await getBalance();
  const pnl = balanceAfter - balanceBefore;
  console.log(`\n=== RESULT ===`);
  console.log(`Balance before: $${balanceBefore.toFixed(4)}`);
  console.log(`Balance after:  $${balanceAfter.toFixed(4)}`);
  console.log(`Net PnL:        ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(4)} (fees + slippage)`);
  console.log(`\n✅ Order code path validated end-to-end on mainnet.`);
}

main().catch((err) => {
  console.error("\n❌ FAILED:", err.message ?? err);
  console.error("\n⚠️  IMPORTANT: If a position was opened but the script crashed,");
  console.error("    open app.hyperliquid.xyz and manually close any open BTC position.");
  process.exit(1);
});
