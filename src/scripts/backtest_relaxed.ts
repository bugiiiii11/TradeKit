/**
 * Strategy Filter Relaxation A/B Backtest
 *
 * Tests whether relaxing S2/S3 entry filters improves performance.
 * Runs 4 variants on 24-month Binance data:
 *   A) Baseline — current production settings
 *   B) S3 relaxed — OB/OS thresholds 75/25 (from 80/20)
 *   C) S2 relaxed — remove 1H-EMA alignment requirement
 *   D) Both relaxed — S3 75/25 + S2 no 1H-EMA
 *
 * Usage:
 *   npx ts-node src/scripts/backtest_relaxed.ts
 *   npx ts-node src/scripts/backtest_relaxed.ts --bankroll 500 --margin 5
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as path from "path";
import { loadBinanceData } from "../backtest/binance-loader";
import { alignBars } from "../backtest/aligner";
import { runBacktest } from "../backtest/engine";
import { resetS1State } from "../strategy/s1_ema_trend";
import { resetS2State } from "../strategy/s2_mean_reversion";
import { resetS3State, S3_CONFIG } from "../strategy/s3_stoch_rsi";
import { S2_CONFIG } from "../strategy/s2_mean_reversion";
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

interface Variant {
  name: string;
  label: string;
  setup: () => void;
  teardown: () => void;
}

function runVariant(
  label: string,
  aligned: ReturnType<typeof alignBars>,
  config: BacktestConfig,
): BacktestResult {
  resetS1State();
  resetS2State();
  resetS3State();
  return runBacktest(aligned, config);
}

function printComparisonTable(variants: Array<{ name: string; result: BacktestResult }>): void {
  const colWidth = 16;

  console.log("\n" + "=".repeat(90));
  console.log("  FILTER RELAXATION A/B COMPARISON");
  console.log("=".repeat(90));

  const headers = ["Metric", ...variants.map(v => v.name)];
  console.log("  " + headers.map((h, i) => i === 0 ? h.padEnd(22) : h.padStart(colWidth)).join(" "));
  console.log("  " + headers.map((_, i) => "─".repeat(i === 0 ? 22 : colWidth)).join(" "));

  const rows: Array<[string, ...string[]]> = [
    ["Total trades", ...variants.map(v => String(v.result.stats.totalTrades))],
    ["Winners", ...variants.map(v => String(v.result.stats.winners))],
    ["Losers", ...variants.map(v => String(v.result.stats.losers))],
    ["Win rate", ...variants.map(v => fmtPct(v.result.stats.winRate))],
    ["Total PnL", ...variants.map(v => `$${fmt(v.result.stats.totalPnlUsd)}`)],
    ["Profit factor", ...variants.map(v => v.result.stats.profitFactor.toFixed(2))],
    ["Avg win", ...variants.map(v => `$${v.result.stats.avgWinUsd.toFixed(2)}`)],
    ["Avg loss", ...variants.map(v => `$${v.result.stats.avgLossUsd.toFixed(2)}`)],
    ["Avg R-multiple", ...variants.map(v => fmt(v.result.stats.avgRMultiple))],
    ["Max DD $", ...variants.map(v => `$${v.result.stats.maxDrawdownUsd.toFixed(2)}`)],
    ["Max DD %", ...variants.map(v => `${v.result.stats.maxDrawdownPct.toFixed(1)}%`)],
    ["Sharpe", ...variants.map(v => v.result.stats.sharpeRatio?.toFixed(2) ?? "N/A")],
  ];

  for (const [label, ...vals] of rows) {
    console.log("  " + label.padEnd(22) + vals.map(v => v.padStart(colWidth)).join(" "));
  }

  // Per-strategy breakdown
  for (const strat of ["S1", "S2", "S3"] as StrategyId[]) {
    const anyHasTrades = variants.some(v => v.result.stats.byStrategy[strat].trades > 0);
    if (!anyHasTrades) continue;

    console.log(`\n  --- ${strat} ---`);
    console.log("  " + ["Metric", ...variants.map(v => v.name)].map((h, i) => i === 0 ? h.padEnd(22) : h.padStart(colWidth)).join(" "));
    console.log("  " + headers.map((_, i) => "─".repeat(i === 0 ? 22 : colWidth)).join(" "));

    const stratRows: Array<[string, ...string[]]> = [
      [`${strat} trades`, ...variants.map(v => String(v.result.stats.byStrategy[strat].trades))],
      [`${strat} win rate`, ...variants.map(v => fmtPct(v.result.stats.byStrategy[strat].winRate))],
      [`${strat} PnL`, ...variants.map(v => `$${fmt(v.result.stats.byStrategy[strat].pnlUsd)}`)],
    ];

    for (const [label, ...vals] of stratRows) {
      console.log("  " + label.padEnd(22) + vals.map(v => v.padStart(colWidth)).join(" "));
    }
  }

  // Delta table (vs baseline)
  const baseline = variants[0].result.stats;
  console.log("\n" + "─".repeat(90));
  console.log("  DELTA vs BASELINE");
  console.log("  " + ["Metric", ...variants.slice(1).map(v => v.name)].map((h, i) => i === 0 ? h.padEnd(22) : h.padStart(colWidth)).join(" "));
  console.log("  " + ["", ...variants.slice(1)].map((_, i) => "─".repeat(i === 0 ? 22 : colWidth)).join(" "));

  const deltaRows: Array<[string, ...string[]]> = [
    ["Δ Trades", ...variants.slice(1).map(v => fmt(v.result.stats.totalTrades - baseline.totalTrades, 0))],
    ["Δ Win rate", ...variants.slice(1).map(v => `${fmt((v.result.stats.winRate - baseline.winRate) * 100, 1)}pp`)],
    ["Δ PnL", ...variants.slice(1).map(v => `$${fmt(v.result.stats.totalPnlUsd - baseline.totalPnlUsd)}`)],
    ["Δ Max DD %", ...variants.slice(1).map(v => `${fmt(v.result.stats.maxDrawdownPct - baseline.maxDrawdownPct, 1)}pp`)],
    ["Δ Profit factor", ...variants.slice(1).map(v => fmt(v.result.stats.profitFactor - baseline.profitFactor))],
  ];

  for (const [label, ...vals] of deltaRows) {
    console.log("  " + label.padEnd(22) + vals.map(v => v.padStart(colWidth)).join(" "));
  }

  // Verdicts
  console.log("\n" + "=".repeat(90));
  console.log("  VERDICTS");
  for (const v of variants.slice(1)) {
    const dPnl = v.result.stats.totalPnlUsd - baseline.totalPnlUsd;
    const dWr = v.result.stats.winRate - baseline.winRate;
    const dDd = v.result.stats.maxDrawdownPct - baseline.maxDrawdownPct;
    let verdict: string;
    if (dPnl > 0 && dDd <= 0) {
      verdict = `ADOPT — +$${dPnl.toFixed(2)} PnL, ${fmt(dDd, 1)}pp drawdown`;
    } else if (dPnl > 0 && dDd > 0) {
      verdict = `CONSIDER — +$${dPnl.toFixed(2)} PnL but +${dDd.toFixed(1)}pp drawdown`;
    } else if (dPnl > 0) {
      verdict = `MARGINAL — +$${dPnl.toFixed(2)} PnL, mixed risk profile`;
    } else {
      verdict = `REJECT — $${dPnl.toFixed(2)} PnL impact`;
    }
    console.log(`  ${v.name}: ${verdict}`);
  }
  console.log("=".repeat(90) + "\n");
}

async function main(): Promise<void> {
  const bankroll = getNumFlag("bankroll", 500);
  const marginPct = getNumFlag("margin", 5) / 100;
  const dataDir = getFlag("data-dir", path.resolve(process.cwd(), "data/bt-data"));
  const pmarpPeriod = getNumFlag("pmarp-period", 20);
  const pmarpLookback = getNumFlag("pmarp-lookback", 350);

  console.log("\n[Relaxed A/B] Strategy Filter Relaxation Comparison");
  console.log(`[Relaxed A/B] Bankroll: $${bankroll} | Margin: ${(marginPct * 100).toFixed(0)}%`);
  console.log(`[Relaxed A/B] PMARP: period=${pmarpPeriod}, lookback=${pmarpLookback}`);
  console.log(`[Relaxed A/B] Data dir: ${dataDir}\n`);

  const t0 = Date.now();

  const collected = await loadBinanceData(dataDir, 700, { pmarpPeriod, pmarpLookback });
  const aligned = alignBars(
    collected.bars15m,
    collected.bars1H,
    collected.bars4H,
    collected.bars1D,
    collected.backtestStartMs,
  );

  if (aligned.length === 0) {
    console.error("[Relaxed A/B] No aligned bars — check data directory.");
    process.exit(1);
  }

  const firstTs = aligned[0].bar15m.timestamp;
  const lastTs = aligned[aligned.length - 1].bar15m.timestamp;
  const days = Math.round((lastTs - firstTs) / (24 * 60 * 60_000));
  console.log(`[Relaxed A/B] Window: ${days} days (${new Date(firstTs).toISOString().split("T")[0]} → ${new Date(lastTs).toISOString().split("T")[0]})`);
  console.log(`[Relaxed A/B] Data loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const enabledStrategies: StrategyId[] = ["S1", "S2", "S3"];
  const baseConfig: BacktestConfig = { days, bankroll, marginPct, enabledStrategies };

  const results: Array<{ name: string; result: BacktestResult }> = [];

  // A) Baseline
  console.log("[Relaxed A/B] Running A: Baseline (current production settings)...");
  S3_CONFIG.obThreshold = 80;
  S3_CONFIG.osThreshold = 20;
  S2_CONFIG.require1hEma = true;
  const baseline = runVariant("Baseline", aligned, baseConfig);
  results.push({ name: "Baseline", result: baseline });
  console.log(`  → ${baseline.trades.length} trades\n`);

  // B) S3 relaxed OB/OS
  console.log("[Relaxed A/B] Running B: S3 OB/OS 75/25...");
  S3_CONFIG.obThreshold = 75;
  S3_CONFIG.osThreshold = 25;
  S2_CONFIG.require1hEma = true;
  const s3Relaxed = runVariant("S3 75/25", aligned, baseConfig);
  results.push({ name: "S3 75/25", result: s3Relaxed });
  console.log(`  → ${s3Relaxed.trades.length} trades\n`);

  // C) S2 no 1H-EMA
  console.log("[Relaxed A/B] Running C: S2 no 1H-EMA requirement...");
  S3_CONFIG.obThreshold = 80;
  S3_CONFIG.osThreshold = 20;
  S2_CONFIG.require1hEma = false;
  const s2Relaxed = runVariant("S2 no-1H", aligned, baseConfig);
  results.push({ name: "S2 no-1H", result: s2Relaxed });
  console.log(`  → ${s2Relaxed.trades.length} trades\n`);

  // D) Both relaxed
  console.log("[Relaxed A/B] Running D: Both (S3 75/25 + S2 no 1H-EMA)...");
  S3_CONFIG.obThreshold = 75;
  S3_CONFIG.osThreshold = 25;
  S2_CONFIG.require1hEma = false;
  const bothRelaxed = runVariant("Both", aligned, baseConfig);
  results.push({ name: "Both", result: bothRelaxed });
  console.log(`  → ${bothRelaxed.trades.length} trades\n`);

  // Reset to production defaults
  S3_CONFIG.obThreshold = 80;
  S3_CONFIG.osThreshold = 20;
  S2_CONFIG.require1hEma = true;

  printComparisonTable(results);

  console.log(`[Relaxed A/B] Total time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(err => {
  console.error("[Relaxed A/B] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
