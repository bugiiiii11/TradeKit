/**
 * GTC limit-order validation test — places unfillable limit orders in both
 * directions, verifies each appears in openOrders, cancels them, and
 * confirms they're gone from the book.
 *
 * Tests:
 *   - placeLimitOrder (GTC) in both `long` and `short` directions
 *   - Order appears in openOrders with the returned oid
 *   - cancelOrder cleans it up
 *   - No fill risk: limits are placed 5% away from mark on the wrong side
 *
 * No money risk beyond potential maker fees if an order somehow fills —
 * but at 5% away from mark on a 20 USD notional, that would require BTC
 * to move 5% in the ~3 second window the order sits on the book, which
 * is effectively impossible.
 *
 * Run with: npx ts-node src/scripts/test_limit_order.ts
 */

import "dotenv/config";
import { getHyperliquidContext } from "../hyperliquid/client";
import { getBalance, getOpenPositions } from "../hyperliquid/account";
import {
  placeLimitOrder,
  cancelOrder,
  type OrderDirection,
} from "../hyperliquid/orders";

const TARGET_NOTIONAL_USD = 20;
const LIMIT_OFFSET_PCT = 0.05; // 5% away from mark — unfillable for the test window
const OBSERVE_MS = 3_000;
const LEVERAGE = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function floorTo(value: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.floor(value * f) / f;
}

/**
 * Place an unfillable GTC limit, verify it's on the book, cancel it,
 * and verify it's gone. Also sanity-checks that no BTC position was opened.
 */
async function testDirection(
  direction: OrderDirection,
  sizeBase: number,
  markPx: number
): Promise<void> {
  const ctx = await getHyperliquidContext();

  // Unfillable price: 5% BELOW mark for longs (buy only if it drops),
  //                   5% ABOVE mark for shorts (sell only if it spikes).
  const rawLimit =
    direction === "long"
      ? markPx * (1 - LIMIT_OFFSET_PCT)
      : markPx * (1 + LIMIT_OFFSET_PCT);

  console.log(
    `\n--- ${direction.toUpperCase()} limit @ ~$${rawLimit.toFixed(2)} ` +
      `(${LIMIT_OFFSET_PCT * 100}% ${direction === "long" ? "below" : "above"} mark) ---`
  );

  // 1. Place the limit order
  const oid = await placeLimitOrder(direction, sizeBase, rawLimit, LEVERAGE);
  console.log(`  ✅ Order placed | oid: ${oid}`);

  await sleep(1000);

  // 2. Verify it appears in openOrders
  const openOrdersBefore = await ctx.info.openOrders({ user: ctx.masterAddress });
  const ours = openOrdersBefore.find((o: { oid: number }) => String(o.oid) === oid);
  if (!ours) {
    console.error(`  ❌ Order ${oid} NOT found in open orders after placement!`);
    console.error(`     Open orders: ${JSON.stringify(openOrdersBefore, null, 2)}`);
    throw new Error(`Order ${oid} missing from book`);
  }
  console.log(`  ✅ Order confirmed on book`);
  console.log(`     ${JSON.stringify(ours)}`);

  // 3. Sanity: no position should have opened (limit didn't fill)
  const positions = await getOpenPositions();
  if (positions.length > 0) {
    console.error(`  ❌ UNEXPECTED: ${positions.length} position(s) open!`);
    console.error(`     The limit must have filled — aborting and cleaning up.`);
    await cancelOrder(oid).catch(() => {});
    throw new Error("Unfillable limit unexpectedly filled");
  }
  console.log(`  ✅ Still flat (no unexpected fill)`);

  // 4. Observe briefly
  await sleep(OBSERVE_MS);

  // 5. Cancel
  console.log(`  Canceling order ${oid}...`);
  await cancelOrder(oid);
  console.log(`  ✅ Cancel sent`);

  await sleep(1000);

  // 6. Verify it's gone from openOrders
  const openOrdersAfter = await ctx.info.openOrders({ user: ctx.masterAddress });
  const stillThere = openOrdersAfter.find((o: { oid: number }) => String(o.oid) === oid);
  if (stillThere) {
    console.error(`  ❌ Order ${oid} STILL on the book after cancel!`);
    throw new Error(`Cancel didn't clear order ${oid}`);
  }
  console.log(`  ✅ Order cleared from book`);
}

async function main(): Promise<void> {
  console.log("=== GTC LIMIT ORDER VALIDATION TEST ===");
  console.log(
    `Places unfillable $${TARGET_NOTIONAL_USD} GTC limits in both directions, ` +
      `verifies book presence, cancels.\n`
  );

  const ctx = await getHyperliquidContext();
  const balanceBefore = await getBalance();
  console.log(`[1/4] Balance before: $${balanceBefore.toFixed(4)}`);

  // Pre-flight: make sure we're flat — the position sanity check below
  // would throw on any pre-existing position and mis-attribute it.
  const preflightPositions = await getOpenPositions();
  if (preflightPositions.length > 0) {
    throw new Error(
      `Account is not flat: ${preflightPositions.length} position(s) open. ` +
        `Close them before running this test.`
    );
  }

  const [, ctxs] = await ctx.info.metaAndAssetCtxs();
  const markPx = parseFloat(ctxs[ctx.btcAssetIndex].markPx);
  const sizeBase = floorTo(TARGET_NOTIONAL_USD / markPx, ctx.btcSzDecimals);
  console.log(`[2/4] BTC mark $${markPx.toFixed(2)} | size ${sizeBase} BTC\n`);

  console.log(`[3/4] Testing both directions...`);
  await testDirection("long", sizeBase, markPx);
  await testDirection("short", sizeBase, markPx);

  // Final safety sweep
  console.log(`\n[4/4] Final safety sweep...`);
  const finalPositions = await getOpenPositions();
  const finalOrders = await ctx.info.openOrders({ user: ctx.masterAddress });
  if (finalPositions.length > 0) {
    console.error(`  ❌ ${finalPositions.length} position(s) still open: ${JSON.stringify(finalPositions)}`);
  } else {
    console.log(`  ✅ No open positions`);
  }
  if (finalOrders.length > 0) {
    console.error(`  ❌ ${finalOrders.length} order(s) still on the book: ${JSON.stringify(finalOrders)}`);
  } else {
    console.log(`  ✅ No leftover orders`);
  }

  const balanceAfter = await getBalance();
  const delta = balanceAfter - balanceBefore;
  console.log(`\n=== RESULT ===`);
  console.log(`Balance before: $${balanceBefore.toFixed(4)}`);
  console.log(`Balance after:  $${balanceAfter.toFixed(4)}`);
  console.log(`Delta:          ${delta >= 0 ? "+" : ""}$${delta.toFixed(4)} (should be ~0)`);
  console.log(`\n✅ placeLimitOrder (GTC) + cancelOrder validated in both directions.`);
}

main().catch((err) => {
  console.error("\n❌ FAILED:", err.message ?? err);
  console.error("\n⚠️  IMPORTANT: Check app.hyperliquid.xyz for any open BTC positions");
  console.error("    or open orders and clean up manually if needed.");
  process.exit(1);
});
