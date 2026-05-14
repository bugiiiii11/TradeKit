/**
 * S6 COMPRESSION_LOOKBACK A/B test: 10 (current) vs 40 (original 4H intent).
 *
 * Loads data once, runs S6-only backtest at both values, compares.
 * Run: npx ts-node src/scripts/backtest_s6_lookback.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as path from "path";
import { loadBinanceData } from "../backtest/binance-loader";
import { alignBars } from "../backtest/aligner";
import { runBacktest } from "../backtest/engine";
import { printResults } from "../backtest/reporter";
import type { BacktestConfig, StrategyId } from "../backtest/types";
import { setS6Lookback } from "../strategy/s6_bbwp_breakout";

async function main(): Promise<void> {
  const dataDir = path.resolve(process.cwd(), "data/bt-data");
  const bankroll = 500;
  const marginPct = 0.05;
  const enabledStrategies: StrategyId[] = ["S6"];
  const indicatorParams = { pmarpPeriod: 20, pmarpLookback: 350 };

  console.log("\n=== S6 COMPRESSION_LOOKBACK A/B Test ===\n");

  const t0 = Date.now();
  const collected = await loadBinanceData(dataDir, 700, indicatorParams);
  const aligned = alignBars(
    collected.bars15m, collected.bars1H, collected.bars4H, collected.bars1D,
    collected.backtestStartMs,
  );
  console.log(`Data loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${aligned.length} aligned bars\n`);

  const firstTs = aligned[0].bar15m.timestamp;
  const lastTs = aligned[aligned.length - 1].bar15m.timestamp;
  const days = Math.round((lastTs - firstTs) / (24 * 60 * 60_000));
  const config: BacktestConfig = { days, bankroll, marginPct, enabledStrategies };

  // Run A: lookback=10 (current)
  console.log("════════════════════════════════════════");
  console.log("  A: COMPRESSION_LOOKBACK = 10 (current)");
  console.log("════════════════════════════════════════\n");
  setS6Lookback(10);
  const resultA = runBacktest(aligned, config);
  printResults(resultA);

  // Run B: lookback=40 (original 4H intent)
  console.log("\n════════════════════════════════════════");
  console.log("  B: COMPRESSION_LOOKBACK = 40 (40h window)");
  console.log("════════════════════════════════════════\n");
  setS6Lookback(40);
  const resultB = runBacktest(aligned, config);
  printResults(resultB);

  // Comparison
  const sA = resultA.stats.byStrategy.S6!;
  const sB = resultB.stats.byStrategy.S6!;
  const stA = resultA.stats;
  const stB = resultB.stats;

  console.log("\n════════════════════════════════════════");
  console.log("  COMPARISON");
  console.log("════════════════════════════════════════\n");
  console.log(`  Metric             | Lookback=10     | Lookback=40`);
  console.log(`  -------------------|-----------------|----------------`);
  console.log(`  Trades             | ${String(sA.trades).padStart(15)} | ${String(sB.trades).padStart(15)}`);
  console.log(`  Win rate           | ${(sA.winRate * 100).toFixed(1).padStart(14)}% | ${(sB.winRate * 100).toFixed(1).padStart(14)}%`);
  console.log(`  PnL                | $${sA.pnlUsd.toFixed(2).padStart(13)} | $${sB.pnlUsd.toFixed(2).padStart(13)}`);
  console.log(`  Avg win            | $${stA.avgWinUsd.toFixed(2).padStart(13)} | $${stB.avgWinUsd.toFixed(2).padStart(13)}`);
  console.log(`  Avg loss           | $${stA.avgLossUsd.toFixed(2).padStart(13)} | $${stB.avgLossUsd.toFixed(2).padStart(13)}`);
  console.log(`  Max drawdown       | ${stA.maxDrawdownPct.toFixed(1).padStart(14)}% | ${stB.maxDrawdownPct.toFixed(1).padStart(14)}%`);
  console.log(`  Profit factor      | ${(stA.profitFactor).toFixed(2).padStart(15)} | ${(stB.profitFactor).toFixed(2).padStart(15)}`);

  const winner = sA.pnlUsd >= sB.pnlUsd ? "10" : "40";
  console.log(`\n  → Winner: lookback=${winner}`);
  console.log(`  → Update s6_bbwp_breakout.ts and fix the stale comment.\n`);
}

main().catch(err => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
