/**
 * Phase 0.3 — 12-month backtest using Binance historical data.
 *
 * Uses locally downloaded Binance CSVs (from download_binance.ts) instead of
 * Hyperliquid's 52-day-limited candle API. Runs all 3 strategies with
 * corrected fees (0.045% taker) and funding rate modeling.
 *
 * Usage:
 *   npx ts-node src/scripts/backtest_binance.ts
 *   npx ts-node src/scripts/backtest_binance.ts --bankroll 500 --margin 5
 *   npx ts-node src/scripts/backtest_binance.ts --data-dir ./data/bt-data
 *
 * Flags:
 *   --bankroll <n>     Starting bankroll in USD (default: 500)
 *   --margin   <n>     Margin per trade as % of bankroll (default: 5)
 *   --data-dir <path>  Path to Binance CSV directory (default: ./data/bt-data)
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as path from "path";
import { loadBinanceData } from "../backtest/binance-loader";
import { alignBars } from "../backtest/aligner";
import { runBacktest } from "../backtest/engine";
import { printResults, saveResultsToFile, saveToSupabase } from "../backtest/reporter";
import type { BacktestConfig } from "../backtest/types";

function getFlag(name: string, defaultVal: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : defaultVal;
}

function getNumFlag(name: string, defaultVal: number): number {
  const raw = getFlag(name, String(defaultVal));
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

async function main(): Promise<void> {
  const bankroll = getNumFlag("bankroll", 500);
  const marginPct = getNumFlag("margin", 5) / 100;
  const dataDir = getFlag("data-dir", path.resolve(process.cwd(), "data/bt-data"));

  console.log(`\n[Backtest-Binance] Starting 12-month backtest`);
  console.log(`[Backtest-Binance] Bankroll: $${bankroll} | Margin: ${(marginPct * 100).toFixed(0)}%`);
  console.log(`[Backtest-Binance] Data dir: ${dataDir}`);
  console.log(`[Backtest-Binance] Fees: 0.045% taker × 2 = 0.09% RT | Funding: 0.00125%/hr\n`);

  const t0 = Date.now();

  // Step 1: load Binance data + aggregate + compute indicators
  const collected = await loadBinanceData(dataDir);
  console.log(`[Backtest-Binance] Data loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Step 2: align
  const aligned = alignBars(
    collected.bars15m,
    collected.bars1H,
    collected.bars4H,
    collected.bars1D,
    collected.backtestStartMs,
  );
  console.log(`[Backtest-Binance] Aligned bars: ${aligned.length}`);

  if (aligned.length === 0) {
    console.error("[Backtest-Binance] No aligned bars — check data directory and CSV files.");
    process.exit(1);
  }

  // Calculate approximate days from aligned bars
  const firstTs = aligned[0].bar15m.timestamp;
  const lastTs = aligned[aligned.length - 1].bar15m.timestamp;
  const days = Math.round((lastTs - firstTs) / (24 * 60 * 60_000));
  console.log(`[Backtest-Binance] Window: ${days} days (${new Date(firstTs).toISOString().split("T")[0]} → ${new Date(lastTs).toISOString().split("T")[0]})`);

  const config: BacktestConfig = { days, bankroll, marginPct };

  // Step 3: replay
  console.log(`[Backtest-Binance] Running strategy replay...`);
  const result = runBacktest(aligned, config);
  console.log(`[Backtest-Binance] Replay complete — ${result.trades.length} trades`);

  // Step 4: output
  printResults(result);
  const outPath = saveResultsToFile(result);
  console.log(`[Backtest-Binance] Results saved to: ${outPath}`);

  // Step 5: decision gate
  console.log("\n=== DECISION GATE ===");
  const { stats } = result;
  const strategies = ["S1", "S2", "S3"] as const;
  let viable = 0;

  for (const id of strategies) {
    const s = stats.byStrategy[id];
    const verdict =
      s.trades < 15
        ? "INSUFFICIENT DATA (<15 trades)"
        : s.pnlUsd > 0
          ? "POSITIVE EXPECTANCY"
          : "NEGATIVE";
    if (s.pnlUsd > 0 && s.trades >= 15) viable++;
    console.log(`  ${id}: ${s.trades} trades, ${s.pnlUsd >= 0 ? "+" : ""}$${s.pnlUsd.toFixed(2)} → ${verdict}`);
  }

  // Total funding impact
  const totalFunding = result.trades.reduce((sum, t) => sum + t.fundingPnl, 0);
  console.log(`\n  Total funding cost: $${totalFunding.toFixed(2)}`);

  if (viable === 0) {
    console.log("\n  RESULT: No strategies show positive expectancy.");
    console.log("  → VPS headless project should NOT proceed without strategy rework.");
  } else {
    console.log(`\n  RESULT: ${viable}/3 strategies viable.`);
    console.log("  → Proceed to Phase 1 (headless WebSocket migration).");
  }

  // Persist to Supabase
  await saveToSupabase(result);
  console.log("");
}

main().catch(err => {
  console.error("[Backtest-Binance] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
