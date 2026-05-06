/**
 * S7 Funding Rate Filter — A/B Backtest Comparison
 *
 * Runs S1+S2+S6 with and without the S7 funding filter using actual
 * Binance historical funding rates. Compares trades filtered, PnL impact,
 * win rate change, and drawdown.
 *
 * Usage:
 *   npx ts-node src/scripts/backtest_s7.ts
 *   npx ts-node src/scripts/backtest_s7.ts --bankroll 500 --margin 5
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as path from "path";
import { loadBinanceData } from "../backtest/binance-loader";
import { alignBars } from "../backtest/aligner";
import { runBacktest } from "../backtest/engine";
import { loadFundingRates } from "../backtest/funding-loader";
import type { BacktestConfig, BacktestResult, StrategyId } from "../backtest/types";
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

function fmtUsd(n: number): string {
  return `${n >= 0 ? "+" : ""}$${n.toFixed(2)}`;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function printComparison(
  label: string,
  baseline: BacktestResult,
  filtered: BacktestResult,
): void {
  const b = baseline.stats;
  const f = filtered.stats;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${"=".repeat(70)}`);

  console.log(`\n  ${"".padEnd(28)} ${"Baseline".padStart(14)} ${"S7 Filter".padStart(14)} ${"Delta".padStart(14)}`);
  console.log(`  ${"─".repeat(70)}`);

  const rows: Array<[string, string, string, string]> = [
    ["Total Trades", String(b.totalTrades), String(f.totalTrades), String(f.totalTrades - b.totalTrades)],
    ["Winners", String(b.winners), String(f.winners), String(f.winners - b.winners)],
    ["Losers", String(b.losers), String(f.losers), String(f.losers - b.losers)],
    ["Win Rate", `${(b.winRate * 100).toFixed(1)}%`, `${(f.winRate * 100).toFixed(1)}%`, fmtPct((f.winRate - b.winRate) * 100)],
    ["Total PnL", fmtUsd(b.totalPnlUsd), fmtUsd(f.totalPnlUsd), fmtUsd(f.totalPnlUsd - b.totalPnlUsd)],
    ["Profit Factor", b.profitFactor.toFixed(2), f.profitFactor.toFixed(2), (f.profitFactor - b.profitFactor).toFixed(2)],
    ["Max Drawdown", `${b.maxDrawdownPct.toFixed(1)}%`, `${f.maxDrawdownPct.toFixed(1)}%`, fmtPct(f.maxDrawdownPct - b.maxDrawdownPct)],
    ["Avg Win", fmtUsd(b.avgWinUsd), fmtUsd(f.avgWinUsd), fmtUsd(f.avgWinUsd - b.avgWinUsd)],
    ["Avg Loss", `-$${b.avgLossUsd.toFixed(2)}`, `-$${f.avgLossUsd.toFixed(2)}`, fmtUsd(b.avgLossUsd - f.avgLossUsd)],
    ["Sharpe", b.sharpeRatio?.toFixed(2) ?? "N/A", f.sharpeRatio?.toFixed(2) ?? "N/A",
      b.sharpeRatio && f.sharpeRatio ? (f.sharpeRatio - b.sharpeRatio).toFixed(2) : "N/A"],
  ];

  for (const [label, bVal, fVal, delta] of rows) {
    console.log(`  ${label.padEnd(28)} ${bVal.padStart(14)} ${fVal.padStart(14)} ${delta.padStart(14)}`);
  }

  console.log(`\n  S7 entries blocked: ${filtered.s7Blocked ?? 0}`);

  // Per-strategy breakdown
  console.log(`\n  Per-Strategy PnL:`);
  for (const id of ["S1", "S2", "S6"] as StrategyId[]) {
    const bS = b.byStrategy[id];
    const fS = f.byStrategy[id];
    console.log(`    ${id}: ${fmtUsd(bS.pnlUsd)} (${bS.trades}t) → ${fmtUsd(fS.pnlUsd)} (${fS.trades}t)  [Δ ${fmtUsd(fS.pnlUsd - bS.pnlUsd)}, ${fS.trades - bS.trades} trades]`);
  }

  // Funding cost comparison
  const bFunding = baseline.trades.reduce((s, t) => s + t.fundingPnl, 0);
  const fFunding = filtered.trades.reduce((s, t) => s + t.fundingPnl, 0);
  console.log(`\n  Total funding cost: ${fmtUsd(bFunding)} → ${fmtUsd(fFunding)} (Δ ${fmtUsd(fFunding - bFunding)})`);
}

function printBlockedTradeAnalysis(
  baseline: BacktestResult,
  filtered: BacktestResult,
): void {
  // Find trades that exist in baseline but not in filtered (by matching entryTimestamp)
  const filteredEntries = new Set(filtered.trades.map(t => t.entryTimestamp));
  const blocked = baseline.trades.filter(t =>
    !filteredEntries.has(t.entryTimestamp) &&
    (t.strategy === "S1" || t.strategy === "S2"),
  );

  if (blocked.length === 0) {
    console.log("\n  No S1/S2 trades were blocked by S7 filter.");
    return;
  }

  const blockedWinners = blocked.filter(t => t.pnlUsd > 0);
  const blockedLosers = blocked.filter(t => t.pnlUsd <= 0);
  const blockedPnl = blocked.reduce((s, t) => s + t.pnlUsd, 0);

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  Blocked Trade Analysis`);
  console.log(`${"=".repeat(70)}`);
  console.log(`  Trades that S7 would have prevented:`);
  console.log(`    Total: ${blocked.length} (${blockedWinners.length} winners, ${blockedLosers.length} losers)`);
  console.log(`    PnL of blocked trades: ${fmtUsd(blockedPnl)}`);
  console.log(`    → Blocking was ${blockedPnl < 0 ? "BENEFICIAL (avoided losses)" : "HARMFUL (missed profits)"}`);

  console.log(`\n  Blocked trade details:`);
  for (const t of blocked) {
    const date = new Date(t.entryTimestamp).toISOString().split("T")[0];
    const result = t.pnlUsd >= 0 ? "WIN" : "LOSS";
    console.log(`    ${date} ${t.strategy} ${t.direction.padEnd(5)} ${fmtUsd(t.pnlUsd).padStart(10)} ${result} (exit: ${t.exitReason})`);
  }
}

async function main(): Promise<void> {
  const bankroll = getNumFlag("bankroll", 500);
  const marginPct = getNumFlag("margin", 5) / 100;
  const dataDir = getFlag("data-dir", path.resolve(process.cwd(), "data/bt-data"));
  const pmarpPeriod = getNumFlag("pmarp-period", 20);
  const pmarpLookback = getNumFlag("pmarp-lookback", 350);
  const fundingCsvPath = path.resolve(dataDir, "BTCUSDT-funding.csv");

  const indicatorParams: IndicatorParams = { pmarpPeriod, pmarpLookback };
  const enabledStrategies: StrategyId[] = ["S1", "S2", "S6"];

  console.log(`\n[S7-Backtest] S7 Funding Rate Filter — A/B Comparison`);
  console.log(`[S7-Backtest] Bankroll: $${bankroll} | Margin: ${(marginPct * 100).toFixed(0)}%`);
  console.log(`[S7-Backtest] Strategies: ${enabledStrategies.join(", ")}`);
  console.log(`[S7-Backtest] PMARP: period=${pmarpPeriod}, lookback=${pmarpLookback}`);
  console.log(`[S7-Backtest] Funding data: ${fundingCsvPath}\n`);

  // Load funding rates
  const fundingRates = loadFundingRates(fundingCsvPath);
  console.log(`[S7-Backtest] Loaded ${fundingRates.length} funding rate records`);
  if (fundingRates.length > 0) {
    const first = new Date(fundingRates[0].timestamp).toISOString().split("T")[0];
    const last = new Date(fundingRates[fundingRates.length - 1].timestamp).toISOString().split("T")[0];
    console.log(`[S7-Backtest] Funding range: ${first} → ${last}`);
  }

  // Load price data
  const t0 = Date.now();
  const collected = await loadBinanceData(dataDir, 700, indicatorParams);
  console.log(`[S7-Backtest] Data loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const aligned = alignBars(
    collected.bars15m,
    collected.bars1H,
    collected.bars4H,
    collected.bars1D,
    collected.backtestStartMs,
  );
  console.log(`[S7-Backtest] Aligned bars: ${aligned.length}`);

  if (aligned.length === 0) {
    console.error("[S7-Backtest] No aligned bars — check data.");
    process.exit(1);
  }

  const firstTs = aligned[0].bar15m.timestamp;
  const lastTs = aligned[aligned.length - 1].bar15m.timestamp;
  const days = Math.round((lastTs - firstTs) / (24 * 60 * 60_000));
  console.log(`[S7-Backtest] Window: ${days} days (${new Date(firstTs).toISOString().split("T")[0]} → ${new Date(lastTs).toISOString().split("T")[0]})`);

  // --- Run A: Baseline (actual funding rates, NO S7 filter) ---
  console.log(`\n[S7-Backtest] Running baseline (S1+S2+S6, actual funding, no S7)...`);
  const baselineConfig: BacktestConfig = {
    days, bankroll, marginPct, enabledStrategies,
    fundingRates,
    s7Filter: false,
  };
  const baseline = runBacktest(aligned, baselineConfig);
  console.log(`[S7-Backtest] Baseline: ${baseline.trades.length} trades, ${fmtUsd(baseline.stats.totalPnlUsd)}`);

  // --- Run B: S7 Filter ON (actual funding rates + S7 filter) ---
  console.log(`[S7-Backtest] Running S7 filter (S1+S2+S6, actual funding, S7 ON)...`);
  const s7Config: BacktestConfig = {
    days, bankroll, marginPct, enabledStrategies,
    fundingRates,
    s7Filter: true,
  };
  const s7Result = runBacktest(aligned, s7Config);
  console.log(`[S7-Backtest] S7 Filter: ${s7Result.trades.length} trades, ${fmtUsd(s7Result.stats.totalPnlUsd)}`);

  // --- Comparison ---
  printComparison("S1+S2+S6 Portfolio: Baseline vs S7 Filter", baseline, s7Result);
  printBlockedTradeAnalysis(baseline, s7Result);

  // --- Verdict ---
  const pnlDelta = s7Result.stats.totalPnlUsd - baseline.stats.totalPnlUsd;
  const ddDelta = s7Result.stats.maxDrawdownPct - baseline.stats.maxDrawdownPct;
  const blocked = s7Result.s7Blocked ?? 0;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  VERDICT`);
  console.log(`${"=".repeat(70)}`);

  if (blocked === 0) {
    console.log(`  S7 filter had NO EFFECT — no entries were blocked.`);
    console.log(`  This likely means funding rate changes between 8h settlements`);
    console.log(`  were too gradual to trigger the velocity threshold.`);
    console.log(`  → Consider adjusting lookback or threshold before enabling.`);
  } else if (pnlDelta > 0 && ddDelta <= 0) {
    console.log(`  S7 filter IMPROVES results: ${fmtUsd(pnlDelta)} PnL, ${fmtPct(ddDelta)} DD`);
    console.log(`  → RECOMMEND: Enable S7_FUNDING_FILTER=true on VPS`);
  } else if (pnlDelta > 0 && ddDelta > 0) {
    console.log(`  S7 filter MIXED: ${fmtUsd(pnlDelta)} PnL but ${fmtPct(ddDelta)} more DD`);
    console.log(`  → MONITOR: Enable with caution, higher DD despite better PnL`);
  } else if (pnlDelta < 0 && ddDelta < 0) {
    console.log(`  S7 filter MIXED: ${fmtUsd(pnlDelta)} PnL but ${fmtPct(ddDelta)} less DD`);
    console.log(`  → CONSIDER: Lower returns but tighter risk — depends on risk appetite`);
  } else {
    console.log(`  S7 filter HURTS: ${fmtUsd(pnlDelta)} PnL, ${fmtPct(ddDelta)} DD`);
    console.log(`  → DO NOT ENABLE in current form. Filter blocks profitable trades.`);
  }

  console.log("");
}

main().catch(err => {
  console.error("[S7-Backtest] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
