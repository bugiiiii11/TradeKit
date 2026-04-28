/**
 * S3 Regime Filter A/B Comparison
 *
 * Runs two backtests on the same 24-month Binance data:
 *   A) S3 baseline (no regime filter)
 *   B) S3 + daily EMA regime filter (5d/21d trend detection from Flash)
 *
 * Prints side-by-side stats and lists which trades get filtered,
 * showing how many were losers vs winners.
 *
 * Usage:
 *   npx ts-node src/scripts/backtest_regime.ts
 *   npx ts-node src/scripts/backtest_regime.ts --bankroll 500 --margin 5
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as path from "path";
import { loadBinanceData } from "../backtest/binance-loader";
import { alignBars } from "../backtest/aligner";
import { runBacktest } from "../backtest/engine";
import type { BacktestConfig, BacktestResult, StrategyId } from "../backtest/types";

function getFlag(name: string, defaultVal: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : defaultVal;
}

function getNumFlag(name: string, defaultVal: number): number {
  const raw = getFlag(name, String(defaultVal));
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

function fmt(n: number, decimals = 2): string {
  const s = n.toFixed(decimals);
  return n >= 0 ? `+${s}` : s;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function printComparison(baseline: BacktestResult, filtered: BacktestResult): void {
  const bS3 = baseline.stats.byStrategy.S3;
  const fS3 = filtered.stats.byStrategy.S3;
  const bStats = baseline.stats;
  const fStats = filtered.stats;

  console.log("\n" + "=".repeat(70));
  console.log("  S3 REGIME FILTER A/B COMPARISON");
  console.log("=".repeat(70));

  const rows: Array<[string, string, string, string]> = [
    ["Metric", "Baseline", "Filtered", "Delta"],
    ["─".repeat(24), "─".repeat(14), "─".repeat(14), "─".repeat(14)],
    ["Total trades", String(bStats.totalTrades), String(fStats.totalTrades), String(fStats.totalTrades - bStats.totalTrades)],
    ["Winners", String(bStats.winners), String(fStats.winners), String(fStats.winners - bStats.winners)],
    ["Losers", String(bStats.losers), String(fStats.losers), String(fStats.losers - bStats.losers)],
    ["Win rate", fmtPct(bStats.winRate), fmtPct(fStats.winRate), fmtPct(fStats.winRate - bStats.winRate)],
    ["Total PnL", `$${fmt(bStats.totalPnlUsd)}`, `$${fmt(fStats.totalPnlUsd)}`, `$${fmt(fStats.totalPnlUsd - bStats.totalPnlUsd)}`],
    ["Profit factor", bStats.profitFactor.toFixed(2), fStats.profitFactor.toFixed(2), fmt(fStats.profitFactor - bStats.profitFactor)],
    ["Avg win", `$${bStats.avgWinUsd.toFixed(2)}`, `$${fStats.avgWinUsd.toFixed(2)}`, `$${fmt(fStats.avgWinUsd - bStats.avgWinUsd)}`],
    ["Avg loss", `$${bStats.avgLossUsd.toFixed(2)}`, `$${fStats.avgLossUsd.toFixed(2)}`, `$${fmt(fStats.avgLossUsd - bStats.avgLossUsd)}`],
    ["Avg R-multiple", fmt(bStats.avgRMultiple), fmt(fStats.avgRMultiple), fmt(fStats.avgRMultiple - bStats.avgRMultiple)],
    ["Max drawdown", `$${bStats.maxDrawdownUsd.toFixed(2)}`, `$${fStats.maxDrawdownUsd.toFixed(2)}`, `$${fmt(fStats.maxDrawdownUsd - bStats.maxDrawdownUsd)}`],
    ["Max DD %", `${bStats.maxDrawdownPct.toFixed(1)}%`, `${fStats.maxDrawdownPct.toFixed(1)}%`, `${fmt(fStats.maxDrawdownPct - bStats.maxDrawdownPct)}%`],
    ["Sharpe", bStats.sharpeRatio?.toFixed(2) ?? "N/A", fStats.sharpeRatio?.toFixed(2) ?? "N/A", bStats.sharpeRatio && fStats.sharpeRatio ? fmt(fStats.sharpeRatio - bStats.sharpeRatio) : "N/A"],
  ];

  for (const [label, b, f, d] of rows) {
    console.log(`  ${label.padEnd(24)} ${b.padStart(14)} ${f.padStart(14)} ${d.padStart(14)}`);
  }

  // Filtered signals analysis
  const filteredSigs = filtered.filteredSignals ?? [];
  console.log(`\n${"─".repeat(70)}`);
  console.log(`  FILTERED SIGNALS: ${filteredSigs.length} S3 entries blocked by regime filter`);

  if (filteredSigs.length > 0) {
    // Cross-reference: find which baseline trades match filtered signals
    // A filtered signal would have become a trade in the baseline run
    // We match by finding baseline trades within ±1 bar (15min) of the filtered timestamp
    const BAR_MS = 15 * 60_000;
    let wouldHaveWon = 0;
    let wouldHaveLost = 0;
    let wouldHavePnl = 0;

    for (const sig of filteredSigs) {
      const matchingTrade = baseline.trades.find(
        t => t.strategy === "S3" && Math.abs(t.entryTimestamp - sig.timestamp) <= BAR_MS,
      );
      if (matchingTrade) {
        if (matchingTrade.pnlUsd > 0) wouldHaveWon++;
        else wouldHaveLost++;
        wouldHavePnl += matchingTrade.pnlUsd;
      }
    }

    console.log(`\n  Cross-reference with baseline trades:`);
    console.log(`    Matched to baseline trades:  ${wouldHaveWon + wouldHaveLost}`);
    console.log(`    Would have been WINNERS:     ${wouldHaveWon}`);
    console.log(`    Would have been LOSERS:      ${wouldHaveLost}`);
    console.log(`    Combined PnL of filtered:    $${fmt(wouldHavePnl)}`);
    if (wouldHavePnl < 0) {
      console.log(`    --> Filter SAVED $${Math.abs(wouldHavePnl).toFixed(2)} by blocking losing trades`);
    } else {
      console.log(`    --> Filter COST $${wouldHavePnl.toFixed(2)} by blocking winning trades`);
    }

    console.log(`\n  Regime breakdown:`);
    const regimeCounts = new Map<string, number>();
    for (const s of filteredSigs) {
      regimeCounts.set(s.regime, (regimeCounts.get(s.regime) ?? 0) + 1);
    }
    for (const [regime, count] of regimeCounts) {
      console.log(`    ${regime}: ${count} signals blocked`);
    }

    console.log(`\n  Filtered signal details:`);
    console.log(`  ${"Date".padEnd(22)} ${"Dir".padEnd(6)} ${"Regime".padEnd(16)} ${"Price".padStart(12)} ${"Baseline PnL".padStart(14)}`);
    console.log(`  ${"─".repeat(22)} ${"─".repeat(6)} ${"─".repeat(16)} ${"─".repeat(12)} ${"─".repeat(14)}`);

    for (const sig of filteredSigs) {
      const date = new Date(sig.timestamp).toISOString().replace("T", " ").slice(0, 19);
      const matchingTrade = baseline.trades.find(
        t => t.strategy === "S3" && Math.abs(t.entryTimestamp - sig.timestamp) <= BAR_MS,
      );
      const pnlStr = matchingTrade
        ? `$${fmt(matchingTrade.pnlUsd)}`
        : "no match";
      console.log(`  ${date.padEnd(22)} ${sig.direction.padEnd(6)} ${sig.regime.padEnd(16)} ${("$" + sig.price.toFixed(0)).padStart(12)} ${pnlStr.padStart(14)}`);
    }
  }

  // Final verdict
  console.log(`\n${"=".repeat(70)}`);
  const pnlDelta = fStats.totalPnlUsd - bStats.totalPnlUsd;
  const wrDelta = fStats.winRate - bStats.winRate;
  const tradesDelta = fStats.totalTrades - bStats.totalTrades;

  if (pnlDelta > 0 && wrDelta >= 0) {
    console.log(`  VERDICT: ADOPT — Filter improves PnL by $${pnlDelta.toFixed(2)} and win rate by ${(wrDelta * 100).toFixed(1)}pp`);
  } else if (pnlDelta > 0) {
    console.log(`  VERDICT: LIKELY ADOPT — Filter improves PnL by $${pnlDelta.toFixed(2)} (${tradesDelta} fewer trades, win rate ${(wrDelta * 100).toFixed(1)}pp)`);
  } else if (pnlDelta < 0) {
    console.log(`  VERDICT: REJECT — Filter hurts PnL by $${Math.abs(pnlDelta).toFixed(2)}`);
  } else {
    console.log(`  VERDICT: NEUTRAL — No PnL impact, removes ${Math.abs(tradesDelta)} trades`);
  }
  console.log("=".repeat(70) + "\n");
}

async function main(): Promise<void> {
  const bankroll = getNumFlag("bankroll", 500);
  const marginPct = getNumFlag("margin", 5) / 100;
  const dataDir = getFlag("data-dir", path.resolve(process.cwd(), "data/bt-data"));
  const pmarpPeriod = getNumFlag("pmarp-period", 20);
  const pmarpLookback = getNumFlag("pmarp-lookback", 350);

  console.log("\n[Regime A/B] S3 Regime Filter Comparison");
  console.log(`[Regime A/B] Bankroll: $${bankroll} | Margin: ${(marginPct * 100).toFixed(0)}%`);
  console.log(`[Regime A/B] PMARP: period=${pmarpPeriod}, lookback=${pmarpLookback}`);
  console.log(`[Regime A/B] Data dir: ${dataDir}\n`);

  const t0 = Date.now();

  // Load data once (shared between both runs)
  const collected = await loadBinanceData(dataDir, 700, { pmarpPeriod, pmarpLookback });
  const aligned = alignBars(
    collected.bars15m,
    collected.bars1H,
    collected.bars4H,
    collected.bars1D,
    collected.backtestStartMs,
  );

  if (aligned.length === 0) {
    console.error("[Regime A/B] No aligned bars — check data directory.");
    process.exit(1);
  }

  const firstTs = aligned[0].bar15m.timestamp;
  const lastTs = aligned[aligned.length - 1].bar15m.timestamp;
  const days = Math.round((lastTs - firstTs) / (24 * 60 * 60_000));
  console.log(`[Regime A/B] Window: ${days} days (${new Date(firstTs).toISOString().split("T")[0]} → ${new Date(lastTs).toISOString().split("T")[0]})`);
  console.log(`[Regime A/B] Data loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const enabledStrategies: StrategyId[] = ["S3"];

  // Run A: S3 baseline (no regime filter)
  console.log("[Regime A/B] Running baseline (S3 only, no filter)...");
  const baselineConfig: BacktestConfig = { days, bankroll, marginPct, enabledStrategies };
  const baseline = runBacktest(aligned, baselineConfig);
  console.log(`[Regime A/B] Baseline: ${baseline.trades.length} trades\n`);

  // Run B: S3 + regime filter
  console.log("[Regime A/B] Running filtered (S3 + daily EMA regime filter)...");
  const filteredConfig: BacktestConfig = { days, bankroll, marginPct, enabledStrategies, regimeFilter: true };
  const filtered = runBacktest(aligned, filteredConfig);
  console.log(`[Regime A/B] Filtered: ${filtered.trades.length} trades (${(filtered.filteredSignals?.length ?? 0)} blocked)\n`);

  // Print comparison
  printComparison(baseline, filtered);

  console.log(`[Regime A/B] Total time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(err => {
  console.error("[Regime A/B] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
