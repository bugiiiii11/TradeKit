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
 *   --train-until <YYYY-MM-DD>  End of the in-sample window (exclusive)
 *   --test-from   <YYYY-MM-DD>  Start of the out-of-sample window (inclusive)
 *   --from <YYYY-MM-DD>  Replay only bars at/after this date (inclusive)
 *   --to   <YYYY-MM-DD>  Replay only bars before this date (exclusive)
 *
 * G3 (S51): pass both split flags to report train and test windows side by side.
 * Parameters may be tuned on the train window only; the test window is report-only.
 * Indicators are computed across the whole dataset before splitting, which is safe
 * because every indicator here looks strictly backwards -- the split slices the
 * replay, not the warmup, so the test window keeps correct indicator state.
 *
 * --train-until/--test-from PRINT both windows and persist neither. Use --from/--to
 * to replay one window and save it (file + Supabase) -- that is how the out-of-sample
 * numbers reach the dashboard, rather than a full-history run nobody should read as a
 * forecast. Same warmup guarantee: indicators are computed before the slice.
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as path from "path";
import { loadBinanceData } from "../backtest/binance-loader";
import { alignBars } from "../backtest/aligner";
import { runBacktest } from "../backtest/engine";
import { printResults, saveResultsToFile, saveToSupabase } from "../backtest/reporter";
import type { BacktestConfig, StrategyId } from "../backtest/types";
import type { IndicatorParams } from "../backtest/collector";

function getFlag(name: string, defaultVal: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : defaultVal;
}

function getNumFlag(name: string, defaultVal: number): number {
  const raw = getFlag(name, String(defaultVal));
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

function printSplitWindow(
  label: string,
  window: ReturnType<typeof alignBars>,
  bankroll: number,
  marginPct: number,
  enabledStrategies: StrategyId[],
): void {
  console.log(`
=== ${label} ===`);
  if (window.length === 0) {
    console.log("  No bars in this window — check the split dates against the data range.");
    return;
  }
  const first = window[0].bar15m.timestamp;
  const last = window[window.length - 1].bar15m.timestamp;
  const days = Math.round((last - first) / (24 * 60 * 60_000));
  console.log(
    `  Window: ${new Date(first).toISOString().split("T")[0]} → ${new Date(last).toISOString().split("T")[0]} (${days} days, ${window.length} bars)`,
  );

  const result = runBacktest(window, { days, bankroll, marginPct, enabledStrategies });
  const st = result.stats;
  console.log(
    `  Trades ${st.totalTrades} | WR ${(st.winRate * 100).toFixed(1)}% | PnL ${st.totalPnlUsd >= 0 ? "+" : ""}$${st.totalPnlUsd.toFixed(2)} ` +
      `| PF ${st.profitFactor.toFixed(2)} | MaxDD $${st.maxDrawdownUsd.toFixed(2)} (${st.maxDrawdownPct.toFixed(1)}%) ` +
      `| Sharpe ${st.sharpeRatio === null ? "n/a (<10 trades)" : st.sharpeRatio.toFixed(2)}`,
  );
  for (const id of enabledStrategies) {
    const bs = st.byStrategy[id];
    if (!bs || bs.trades === 0) continue;
    console.log(
      `    ${id}: ${bs.trades} trades, WR ${(bs.winRate * 100).toFixed(1)}%, ${bs.pnlUsd >= 0 ? "+" : ""}$${bs.pnlUsd.toFixed(2)}`,
    );
  }
}

async function main(): Promise<void> {
  const bankroll = getNumFlag("bankroll", 500);
  const marginPct = getNumFlag("margin", 5) / 100;
  const dataDir = getFlag("data-dir", path.resolve(process.cwd(), "data/bt-data"));
  const pmarpPeriod = getNumFlag("pmarp-period", 20);
  const pmarpLookback = getNumFlag("pmarp-lookback", 350);
  const strategiesRaw = getFlag("strategies", "S1,S2,S3");
  const trainUntil = getFlag("train-until", "");
  const testFrom = getFlag("test-from", "");
  const fromDate = getFlag("from", "");
  const toDate = getFlag("to", "");
  const enabledStrategies = strategiesRaw.split(",").map(s => s.trim()) as StrategyId[];

  const indicatorParams: IndicatorParams = { pmarpPeriod, pmarpLookback };

  console.log(`\n[Backtest-Binance] Starting backtest`);
  console.log(`[Backtest-Binance] Bankroll: $${bankroll} | Margin: ${(marginPct * 100).toFixed(0)}%`);
  console.log(`[Backtest-Binance] Strategies: ${enabledStrategies.join(", ")}`);
  console.log(`[Backtest-Binance] PMARP: period=${pmarpPeriod}, lookback=${pmarpLookback}`);
  console.log(`[Backtest-Binance] Data dir: ${dataDir}`);
  console.log(`[Backtest-Binance] Fees: 0.045% taker × 2 = 0.09% RT | Funding: 0.00125%/hr\n`);

  const t0 = Date.now();

  // Step 1: load Binance data + aggregate + compute indicators
  const collected = await loadBinanceData(dataDir, 700, indicatorParams);
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

  // Optional replay window. Applied AFTER alignment so indicator warmup still
  // uses the full dataset -- slicing the replay, never the warmup.
  let replay = aligned;
  if (fromDate || toDate) {
    const fromMs = fromDate ? Date.parse(`${fromDate}T00:00:00Z`) : NaN;
    const toMs = toDate ? Date.parse(`${toDate}T00:00:00Z`) : NaN;
    if (fromDate && !Number.isFinite(fromMs)) {
      console.error(`[Backtest-Binance] --from is not a valid YYYY-MM-DD date: ${fromDate}`);
      process.exit(1);
    }
    if (toDate && !Number.isFinite(toMs)) {
      console.error(`[Backtest-Binance] --to is not a valid YYYY-MM-DD date: ${toDate}`);
      process.exit(1);
    }
    replay = aligned.filter(a =>
      (!Number.isFinite(fromMs) || a.bar15m.timestamp >= fromMs) &&
      (!Number.isFinite(toMs) || a.bar15m.timestamp < toMs));
    if (replay.length === 0) {
      console.error("[Backtest-Binance] --from/--to selected no bars.");
      process.exit(1);
    }
    console.log(`[Backtest-Binance] Replay window: ${replay.length} bars of ${aligned.length}`);
  }

  // Calculate approximate days from aligned bars
  const firstTs = replay[0].bar15m.timestamp;
  const lastTs = replay[replay.length - 1].bar15m.timestamp;
  const days = Math.round((lastTs - firstTs) / (24 * 60 * 60_000));
  console.log(`[Backtest-Binance] Window: ${days} days (${new Date(firstTs).toISOString().split("T")[0]} → ${new Date(lastTs).toISOString().split("T")[0]})`);

  const config: BacktestConfig = { days, bankroll, marginPct, enabledStrategies };

  // Step 2b (G3): optional train/test split — report only, no parameter fitting here.
  if (trainUntil || testFrom) {
    const trainEnd = trainUntil ? Date.parse(`${trainUntil}T00:00:00Z`) : NaN;
    const testStart = testFrom ? Date.parse(`${testFrom}T00:00:00Z`) : NaN;
    if (trainUntil && !Number.isFinite(trainEnd)) {
      console.error(`[Backtest-Binance] --train-until is not a valid YYYY-MM-DD date: ${trainUntil}`);
      process.exit(1);
    }
    if (testFrom && !Number.isFinite(testStart)) {
      console.error(`[Backtest-Binance] --test-from is not a valid YYYY-MM-DD date: ${testFrom}`);
      process.exit(1);
    }

    const train = Number.isFinite(trainEnd)
      ? aligned.filter(a => a.bar15m.timestamp < trainEnd)
      : [];
    const test = Number.isFinite(testStart)
      ? aligned.filter(a => a.bar15m.timestamp >= testStart)
      : [];

    printSplitWindow("TRAIN (in-sample — parameters may be fitted here)", train, bankroll, marginPct, enabledStrategies);
    printSplitWindow("TEST (out-of-sample — report only, never fit)", test, bankroll, marginPct, enabledStrategies);
    console.log("");
    return;
  }

  // Step 3: replay
  console.log(`[Backtest-Binance] Running strategy replay...`);
  const result = runBacktest(replay, config);
  console.log(`[Backtest-Binance] Replay complete — ${result.trades.length} trades`);

  // Step 4: output
  printResults(result);
  const outPath = saveResultsToFile(result);
  console.log(`[Backtest-Binance] Results saved to: ${outPath}`);

  // Step 5: decision gate
  console.log("\n=== DECISION GATE ===");
  const { stats } = result;
  const strategies = ["S1", "S2", "S3", "S6"] as const;
  let viable = 0;
  let evaluated = 0;

  for (const id of strategies) {
    const s = stats.byStrategy[id];
    if (!s || s.trades === 0) continue;
    evaluated++;
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
    console.log("  → Review strategy parameters before deploying.");
  } else {
    console.log(`\n  RESULT: ${viable}/${evaluated} strategies viable.`);
    console.log("  → Strategies with positive expectancy are deployment-ready.");
  }

  // Persist to Supabase
  await saveToSupabase(result);
  console.log("");
}

main().catch(err => {
  console.error("[Backtest-Binance] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
