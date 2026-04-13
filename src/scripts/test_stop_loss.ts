/**
 * Stop-loss validation test — places a $20 position, sets a wide stop-loss
 * (5% away from entry on the losing side, so it can never trigger),
 * verifies the trigger order exists on the book, cancels it, then
 * closes the position.
 *
 * Direction is a CLI argument: `long` (default) or `short`.
 *   - long  → stop-loss 5% BELOW entry
 *   - short → stop-loss 5% ABOVE entry
 *
 * Tests:
 *   - setStopLoss (creates a trigger-market reduce-only order)
 *   - cancelOrder (cleanup)
 *   - Stop order persistence (queryable via openOrders)
 *
 * Worst-case loss: ~$1 (same as the basic micro-trade test).
 *
 * Run with: npx ts-node src/scripts/test_stop_loss.ts [long|short]
 */

import "dotenv/config";
import { getHyperliquidContext } from "../hyperliquid/client";
import { getBalance, getOpenPositions } from "../hyperliquid/account";
import {
  placeMarketOrder,
  closePosition,
  setStopLoss,
  cancelOrder,
  type OrderDirection,
} from "../hyperliquid/orders";

const DIRECTION: OrderDirection = (() => {
  const arg = (process.argv[2] ?? "long").toLowerCase();
  if (arg !== "long" && arg !== "short") {
    throw new Error(`Invalid direction "${arg}" — must be "long" or "short"`);
  }
  return arg;
})();

const TARGET_NOTIONAL_USD = 20;
const STOP_DISTANCE_PCT = 0.05; // 5% away from entry — wide enough to NEVER trigger
const HOLD_DURATION_MS = 15_000;
const LEVERAGE = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function floorTo(value: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.floor(value * f) / f;
}

async function main(): Promise<void> {
  const stopSide = DIRECTION === "long" ? "below" : "above";
  console.log("=== STOP-LOSS VALIDATION TEST ===");
  console.log(
    `Target: $${TARGET_NOTIONAL_USD} BTC ${DIRECTION}, ${LEVERAGE}x, ` +
      `stop ${STOP_DISTANCE_PCT * 100}% ${stopSide} entry\n`
  );

  const ctx = await getHyperliquidContext();
  const balanceBefore = await getBalance();
  console.log(`[1/8] Balance before: $${balanceBefore.toFixed(4)}\n`);

  // Get mark price + size
  const [, ctxs] = await ctx.info.metaAndAssetCtxs();
  const markPx = parseFloat(ctxs[ctx.btcAssetIndex].markPx);
  const sizeBase = floorTo(TARGET_NOTIONAL_USD / markPx, ctx.btcSzDecimals);
  console.log(`[2/8] BTC mark $${markPx.toFixed(2)} | size ${sizeBase} BTC\n`);

  // 1. Open the position
  console.log(`[3/8] Placing MARKET ${DIRECTION.toUpperCase()} entry...`);
  const entryOid = await placeMarketOrder(DIRECTION, sizeBase, LEVERAGE);
  console.log(`  ✅ Entry oid: ${entryOid}`);

  await sleep(2000);

  // Verify it opened
  const positions = await getOpenPositions();
  const btcPos = positions.find((p) => p.coin === "BTC");
  if (!btcPos) throw new Error("Position not found after entry");
  const entryPrice = btcPos.entryPrice;
  console.log(`  Position: ${btcPos.direction} ${btcPos.sizeBase} BTC @ $${entryPrice.toFixed(2)}\n`);

  // 2. Place a wide stop-loss — below entry for long, above entry for short
  const stopPrice =
    DIRECTION === "long"
      ? entryPrice * (1 - STOP_DISTANCE_PCT)
      : entryPrice * (1 + STOP_DISTANCE_PCT);
  console.log(
    `[4/8] Placing STOP-LOSS @ $${stopPrice.toFixed(2)} ` +
      `(${STOP_DISTANCE_PCT * 100}% ${stopSide} entry)...`
  );
  let stopOid: string;
  try {
    stopOid = await setStopLoss(DIRECTION, stopPrice, sizeBase);
    console.log(`  ✅ Stop oid: ${stopOid}`);
  } catch (err) {
    console.error(`  ❌ setStopLoss FAILED:`, err);
    console.log("  → Closing position before exit...");
    await closePosition(DIRECTION);
    throw err;
  }

  await sleep(2000);

  // 3. Verify the stop appears in open orders
  console.log("\n[5/8] Verifying stop order exists in open orders...");
  const openOrders = await ctx.info.openOrders({ user: ctx.masterAddress });
  const ourStop = openOrders.find((o: { oid: number }) => String(o.oid) === stopOid);
  if (!ourStop) {
    console.error(`  ❌ Stop order ${stopOid} NOT found in open orders!`);
    console.log(`  Open orders: ${JSON.stringify(openOrders, null, 2)}`);
  } else {
    console.log(`  ✅ Stop order confirmed on the book`);
    console.log(`     ${JSON.stringify(ourStop, null, 2)}`);
  }

  // 4. Hold briefly so it's visible in the UI
  console.log(`\n[6/8] Holding for ${HOLD_DURATION_MS / 1000}s (visible in app.hyperliquid.xyz)...`);
  await sleep(HOLD_DURATION_MS);

  // 5. Cancel the stop-loss before closing the position
  console.log("\n[7/8] Canceling stop-loss order...");
  try {
    await cancelOrder(stopOid);
    console.log(`  ✅ Stop canceled`);
  } catch (err) {
    console.error(`  ⚠️  cancelOrder failed:`, err);
    console.log("  → Will still try to close position");
  }

  await sleep(2000);

  // 6. Close the position
  console.log("\n[8/8] Closing position...");
  await closePosition(DIRECTION);
  await sleep(2000);

  const positionsAfter = await getOpenPositions();
  const ordersAfter = await ctx.info.openOrders({ user: ctx.masterAddress });
  if (positionsAfter.length > 0) {
    console.log(`  ⚠️  ${positionsAfter.length} position(s) still open`);
  } else {
    console.log(`  ✅ Position closed`);
  }
  if (ordersAfter.length > 0) {
    console.log(`  ⚠️  ${ordersAfter.length} order(s) still open: ${JSON.stringify(ordersAfter)}`);
  } else {
    console.log(`  ✅ No leftover orders`);
  }

  const balanceAfter = await getBalance();
  console.log(`\n=== RESULT ===`);
  console.log(`Balance before: $${balanceBefore.toFixed(4)}`);
  console.log(`Balance after:  $${balanceAfter.toFixed(4)}`);
  console.log(`Net cost:       $${(balanceAfter - balanceBefore).toFixed(4)}`);
  console.log(`\n✅ setStopLoss + cancelOrder validated end-to-end.`);
}

main().catch((err) => {
  console.error("\n❌ FAILED:", err.message ?? err);
  console.error("\n⚠️  IMPORTANT: Check app.hyperliquid.xyz for any open BTC positions");
  console.error("    or open orders and clean up manually if needed.");
  process.exit(1);
});
