/**
 * Stop-loss auto-cleanup test — validates that closePosition automatically
 * cancels any resting reduce-only BTC stops after a successful close.
 *
 * Flow:
 *   1. Pre-flight flat check (positions AND open orders)
 *   2. Open $20 BTC long @ 1x via placeMarketOrder
 *   3. Set a 5%-below-entry stop via setStopLoss
 *   4. Verify the stop appears in openOrders
 *   5. Call closePosition("long") — this is the code path under test
 *   6. Verify: position flat AND openOrders returns 0 BTC orders
 *
 * Worst-case loss: ~$1 (same as test_micro_trade).
 *
 * Run with: npx ts-node src/scripts/test_stop_cleanup.ts
 */

import "dotenv/config";
import { getHyperliquidContext } from "../hyperliquid/client";
import { getBalance, getOpenPositions } from "../hyperliquid/account";
import { placeMarketOrder, closePosition, setStopLoss } from "../hyperliquid/orders";

const TARGET_NOTIONAL_USD = 20;
const STOP_DISTANCE_PCT = 0.05;
const LEVERAGE = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function floorTo(value: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.floor(value * f) / f;
}

async function main(): Promise<void> {
  console.log("=== STOP-LOSS AUTO-CLEANUP TEST ===");
  console.log(
    `Validates closePosition auto-cancels orphaned stops.\n` +
      `Target: $${TARGET_NOTIONAL_USD} BTC long, ${LEVERAGE}x, ` +
      `stop ${STOP_DISTANCE_PCT * 100}% below entry.\n`
  );

  const ctx = await getHyperliquidContext();
  const balanceBefore = await getBalance();
  console.log(`[1/7] Balance before: $${balanceBefore.toFixed(4)}`);

  // Pre-flight: must be fully flat — no positions AND no open orders
  const preflightPositions = await getOpenPositions();
  const preflightOrders = await ctx.info.openOrders({ user: ctx.masterAddress });
  if (preflightPositions.length > 0) {
    throw new Error(
      `Account is not flat: ${preflightPositions.length} position(s) open. ` +
        `Close them before running this test.`
    );
  }
  if (preflightOrders.length > 0) {
    throw new Error(
      `Open orders on the book: ${preflightOrders.length}. ` +
        `Cancel them before running this test (they'd skew the cleanup check).`
    );
  }
  console.log(`[2/7] Pre-flight: flat (0 positions, 0 open orders)\n`);

  // Get mark price + size
  const [, ctxs] = await ctx.info.metaAndAssetCtxs();
  const markPx = parseFloat(ctxs[ctx.btcAssetIndex].markPx);
  const sizeBase = floorTo(TARGET_NOTIONAL_USD / markPx, ctx.btcSzDecimals);
  console.log(`[3/7] BTC mark $${markPx.toFixed(2)} | size ${sizeBase} BTC\n`);

  // Open position
  console.log("[4/7] Placing MARKET LONG entry...");
  const entryOid = await placeMarketOrder("long", sizeBase, LEVERAGE);
  console.log(`  ✅ Entry oid: ${entryOid}`);
  await sleep(2000);

  const positions = await getOpenPositions();
  const btcPos = positions.find((p) => p.coin === "BTC");
  if (!btcPos) throw new Error("Position not found after entry");
  console.log(`  Position: ${btcPos.direction} ${btcPos.sizeBase} BTC @ $${btcPos.entryPrice.toFixed(2)}\n`);

  // Place stop-loss
  const stopPrice = btcPos.entryPrice * (1 - STOP_DISTANCE_PCT);
  console.log(`[5/7] Placing STOP-LOSS @ $${stopPrice.toFixed(2)}...`);
  let stopOid: string;
  try {
    stopOid = await setStopLoss("long", stopPrice, sizeBase);
    console.log(`  ✅ Stop oid: ${stopOid}`);
  } catch (err) {
    console.error(`  ❌ setStopLoss FAILED:`, err);
    console.log("  → Closing position before exit...");
    await closePosition("long");
    throw err;
  }
  await sleep(1500);

  // Verify stop is on the book
  const ordersBeforeClose = await ctx.info.openOrders({ user: ctx.masterAddress });
  const ourStop = ordersBeforeClose.find((o: { oid: number }) => String(o.oid) === stopOid);
  if (!ourStop) {
    throw new Error(`Stop ${stopOid} not found on book before close — can't test cleanup`);
  }
  console.log(`  ✅ Stop confirmed on book (${ordersBeforeClose.length} total order(s))\n`);

  // THE TEST: close position — closePosition should auto-cancel the stop
  console.log("[6/7] Calling closePosition('long') — auto-cleanup path under test...");
  const closeOid = await closePosition("long");
  console.log(`  Close oid: ${closeOid}`);
  await sleep(2000);

  // VERIFY: position flat + zero BTC orders on book
  console.log("\n[7/7] Verifying auto-cleanup...");
  const positionsAfter = await getOpenPositions();
  const ordersAfter = await ctx.info.openOrders({ user: ctx.masterAddress });

  let pass = true;
  if (positionsAfter.length > 0) {
    console.error(`  ❌ ${positionsAfter.length} position(s) still open: ${JSON.stringify(positionsAfter)}`);
    pass = false;
  } else {
    console.log(`  ✅ No open positions`);
  }

  const btcOrdersAfter = ordersAfter.filter((o: { coin?: string }) => o.coin === "BTC");
  if (btcOrdersAfter.length > 0) {
    console.error(
      `  ❌ AUTO-CLEANUP FAILED: ${btcOrdersAfter.length} BTC order(s) still on book:`
    );
    console.error(`     ${JSON.stringify(btcOrdersAfter, null, 2)}`);
    pass = false;
  } else {
    console.log(`  ✅ No leftover BTC orders (stop was auto-canceled)`);
  }

  const balanceAfter = await getBalance();
  const delta = balanceAfter - balanceBefore;
  console.log(`\n=== RESULT ===`);
  console.log(`Balance before: $${balanceBefore.toFixed(4)}`);
  console.log(`Balance after:  $${balanceAfter.toFixed(4)}`);
  console.log(`Net cost:       ${delta >= 0 ? "+" : ""}$${delta.toFixed(4)}`);

  if (!pass) {
    throw new Error("Auto-cleanup verification FAILED — see above");
  }
  console.log(`\n✅ closePosition auto-cleanup validated end-to-end.`);
}

main().catch((err) => {
  console.error("\n❌ FAILED:", err.message ?? err);
  console.error("\n⚠️  IMPORTANT: Check app.hyperliquid.xyz for any open BTC positions");
  console.error("    or open orders and clean up manually if needed.");
  process.exit(1);
});
