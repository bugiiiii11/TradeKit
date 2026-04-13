/**
 * Hyperliquid connection smoke test — READ-ONLY.
 *
 * Verifies:
 *   - .env credentials parse
 *   - Network connectivity to Hyperliquid
 *   - InfoClient works (clearinghouseState, metaAndAssetCtxs)
 *   - Balance, positions, and funding rate are readable
 *
 * Does NOT place any orders. Run with: npx ts-node src/scripts/test_connection.ts
 */

import "dotenv/config";
import { getHyperliquidContext } from "../hyperliquid/client";
import { getBalance, getOpenPositions, getFundingRate } from "../hyperliquid/account";

async function main(): Promise<void> {
  console.log("[Test] Initializing Hyperliquid context...");
  const ctx = await getHyperliquidContext();

  console.log("\n[Test] Fetching balance...");
  const balance = await getBalance();
  console.log(`  Withdrawable USDC: $${balance.toFixed(2)}`);

  console.log("\n[Test] Fetching open BTC positions...");
  const positions = await getOpenPositions();
  if (positions.length === 0) {
    console.log("  (none)");
  } else {
    for (const p of positions) {
      console.log(
        `  ${p.direction.toUpperCase()} ${p.sizeBase} BTC @ $${p.entryPrice} | ` +
          `unrealized PnL: $${p.unrealizedPnl.toFixed(2)}`
      );
    }
  }

  console.log("\n[Test] Fetching BTC funding rate...");
  const funding = await getFundingRate();
  console.log(`  Hourly funding: ${(funding * 100).toFixed(5)}%`);

  console.log("\n[Test] ✅ All checks passed. Hyperliquid connection is healthy.");
  console.log(`[Test] Network: ${ctx.isTestnet ? "TESTNET" : "MAINNET"}`);
}

main().catch((err) => {
  console.error("\n[Test] ❌ FAILED:", err.message ?? err);
  process.exit(1);
});
