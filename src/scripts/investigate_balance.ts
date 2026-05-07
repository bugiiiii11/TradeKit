/**
 * One-shot balance investigation for VPS wallet.
 * Queries Hyperliquid InfoClient (read-only) for fills, funding, and ledger events.
 * Usage: npx ts-node src/scripts/investigate_balance.ts
 */

import * as hl from "@nktkas/hyperliquid";

const VPS_MASTER = "0x5642A41938903483486085D3672535e3a7044110" as const;
const LOOKBACK_DAYS = 14;

async function main() {
  const transport = new hl.HttpTransport({ isTestnet: false });
  const info = new hl.InfoClient({ transport });
  const startTime = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  console.log(`\n=== Balance Investigation ===`);
  console.log(`Wallet: ${VPS_MASTER}`);
  console.log(`Window: last ${LOOKBACK_DAYS} days (since ${new Date(startTime).toISOString()})\n`);

  // 1. Current balance
  const state = await info.clearinghouseState({ user: VPS_MASTER });
  console.log(`--- Current State ---`);
  console.log(`  Withdrawable: $${parseFloat(state.withdrawable).toFixed(2)}`);
  console.log(`  Account value: $${parseFloat(state.marginSummary.accountValue).toFixed(2)}`);
  console.log(`  Open positions: ${state.assetPositions.filter(p => parseFloat(p.position.szi) !== 0).length}`);
  console.log();

  // 2. Fills (trades)
  const fills = await info.userFillsByTime({ user: VPS_MASTER, startTime });
  console.log(`--- Fills (${fills.length} total) ---`);
  if (fills.length === 0) {
    console.log("  No trades in window.");
  } else {
    let totalFees = 0;
    let totalPnl = 0;
    for (const f of fills) {
      const fee = parseFloat(f.fee);
      const pnl = parseFloat(f.closedPnl);
      totalFees += fee;
      totalPnl += pnl;
      console.log(`  ${new Date(f.time).toISOString()} | ${f.side === "B" ? "BUY " : "SELL"} ${f.coin} | px=${f.px} sz=${f.sz} | pnl=$${pnl.toFixed(4)} fee=$${fee.toFixed(4)}`);
    }
    console.log(`  TOTAL fees: $${totalFees.toFixed(4)} | TOTAL closed PnL: $${totalPnl.toFixed(4)}`);
  }
  console.log();

  // 3. Funding payments
  const funding = await info.userFunding({ user: VPS_MASTER, startTime });
  console.log(`--- Funding Payments (${funding.length} total) ---`);
  if (funding.length === 0) {
    console.log("  No funding payments in window.");
  } else {
    let totalFunding = 0;
    for (const f of funding) {
      const usdc = parseFloat(f.delta.usdc);
      totalFunding += usdc;
      console.log(`  ${new Date(f.time).toISOString()} | ${f.delta.coin} | $${usdc.toFixed(4)} | rate=${f.delta.fundingRate} | size=${f.delta.szi}`);
    }
    console.log(`  TOTAL funding: $${totalFunding.toFixed(4)}`);
  }
  console.log();

  // 4. Non-funding ledger (transfers, withdrawals, deposits, liquidations)
  const ledger = await info.userNonFundingLedgerUpdates({ user: VPS_MASTER, startTime });
  console.log(`--- Ledger Events (${ledger.length} total) ---`);
  if (ledger.length === 0) {
    console.log("  No ledger events in window.");
  } else {
    for (const e of ledger) {
      const d = e.delta as unknown as Record<string, unknown>;
      console.log(`  ${new Date(e.time).toISOString()} | type=${d.type} | usdc=${d.usdc ?? "N/A"} | ${JSON.stringify(d)}`);
    }
  }
  console.log();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
