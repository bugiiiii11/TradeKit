/**
 * S1 Daily-EMA200 Filter A/B Backtest
 *
 * Tests whether removing the Daily-EMA200 requirement from S1 improves
 * performance. S1 still requires 4H-EMA200 and all EMA alignment checks.
 *
 * Variants:
 *   A) Baseline — S1 requires Daily-EMA200 (current production)
 *   B) S1 no Daily-EMA200 — only 4H-EMA200 required
 *   C) S1-only baseline — isolate S1 performance
 *   D) S1-only no Daily-EMA200 — isolate relaxed S1 performance
 *
 * Usage:
 *   npx ts-node src/scripts/backtest_s1_filter.ts
 *   npx ts-node src/scripts/backtest_s1_filter.ts --bankroll 500 --margin 5
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as path from "path";
import { loadBinanceData } from "../backtest/binance-loader";
import { alignBars } from "../backtest/aligner";
import { runBacktest } from "../backtest/engine";
import { resetS1State, S1_CONFIG } from "../strategy/s1_ema_trend";
import { resetS2State } from "../strategy/s2_mean_reversion";
import { resetS3State } from "../strategy/s3_stoch_rsi";
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
  const colWidth = 18;

  console.log("\n" + "=".repeat(100));
  console.log("  S1 DAILY-EMA200 FILTER A/B COMPARISON");
  console.log("=".repeat(100));

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
    const anyHasTrades = variants.some(v => v.result.stats.byStrategy[strat]?.trades > 0);
    if (!anyHasTrades) continue;

    console.log(`\n  --- ${strat} ---`);
    console.log("  " + ["Metric", ...variants.map(v => v.name)].map((h, i) => i === 0 ? h.padEnd(22) : h.padStart(colWidth)).join(" "));
    console.log("  " + headers.map((_, i) => "─".repeat(i === 0 ? 22 : colWidth)).join(" "));

    const stratRows: Array<[string, ...string[]]> = [
      [`${strat} trades`, ...variants.map(v => String(v.result.stats.byStrategy[strat]?.trades ?? 0))],
      [`${strat} win rate`, ...variants.map(v => fmtPct(v.result.stats.byStrategy[strat]?.winRate ?? 0))],
      [`${strat} PnL`, ...variants.map(v => `$${fmt(v.result.stats.byStrategy[strat]?.pnlUsd ?? 0)}`)],
    ];

    for (const [label, ...vals] of stratRows) {
      console.log("  " + label.padEnd(22) + vals.map(v => v.padStart(colWidth)).join(" "));
    }
  }

  // Delta table (vs first variant)
  const baseline = variants[0].result.stats;
  console.log("\n" + "─".repeat(100));
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
  console.log("\n" + "=".repeat(100));
  console.log("  VERDICTS");
  for (const v of variants.slice(1)) {
    const dPnl = v.result.stats.totalPnlUsd - baseline.totalPnlUsd;
    const dDd = v.result.stats.maxDrawdownPct - baseline.maxDrawdownPct;
    let verdict: string;
    if (dPnl > 0 && dDd <= 0) {
      verdict = `ADOPT — +$${dPnl.toFixed(2)} PnL, ${fmt(dDd, 1)}pp drawdown`;
    } else if (dPnl > 0 && dDd > 2) {
      verdict = `RISKY — +$${dPnl.toFixed(2)} PnL but +${dDd.toFixed(1)}pp drawdown`;
    } else if (dPnl > 0) {
      verdict = `CONSIDER — +$${dPnl.toFixed(2)} PnL, +${dDd.toFixed(1)}pp drawdown`;
    } else {
      verdict = `REJECT — $${dPnl.toFixed(2)} PnL impact`;
    }
    console.log(`  ${v.name}: ${verdict}`);
  }
  console.log("=".repeat(100) + "\n");

  // Print S1 trade list for the relaxed variant to inspect new entries
  const relaxedAll = variants.find(v => v.name === "No Daily-EMA200");
  const baselineAll = variants.find(v => v.name === "Baseline");
  if (relaxedAll && baselineAll) {
    const baseS1Count = baselineAll.result.stats.byStrategy.S1?.trades ?? 0;
    const relaxedS1Count = relaxedAll.result.stats.byStrategy.S1?.trades ?? 0;
    const newTrades = relaxedS1Count - baseS1Count;
    if (newTrades > 0) {
      console.log(`  NEW S1 TRADES (${newTrades} additional entries from removing Daily-EMA200):`);
      const s1Trades = relaxedAll.result.trades.filter(t => t.strategy === "S1");
      for (const t of s1Trades) {
        const date = new Date(t.entryTimestamp).toISOString().slice(0, 10);
        const pnl = t.pnlUsd >= 0 ? `+$${t.pnlUsd.toFixed(2)}` : `-$${Math.abs(t.pnlUsd).toFixed(2)}`;
        console.log(`    ${date} ${t.direction.padEnd(5)} entry=$${t.entryPrice.toFixed(0)} exit=$${t.exitPrice.toFixed(0)} ${pnl} (${t.exitReason})`);
      }
      console.log();
    }
  }
}

async function main(): Promise<void> {
  const bankroll = getNumFlag("bankroll", 500);
  const marginPct = getNumFlag("margin", 5) / 100;
  const dataDir = getFlag("data-dir", path.resolve(process.cwd(), "data/bt-data"));
  const pmarpPeriod = getNumFlag("pmarp-period", 20);
  const pmarpLookback = getNumFlag("pmarp-lookback", 350);

  console.log("\n[S1-Filter] S1 Daily-EMA200 Filter A/B Comparison");
  console.log(`[S1-Filter] Bankroll: $${bankroll} | Margin: ${(marginPct * 100).toFixed(0)}%`);
  console.log(`[S1-Filter] PMARP: period=${pmarpPeriod}, lookback=${pmarpLookback}`);
  console.log(`[S1-Filter] Data dir: ${dataDir}\n`);

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
    console.error("[S1-Filter] No aligned bars — check data directory.");
    process.exit(1);
  }

  const firstTs = aligned[0].bar15m.timestamp;
  const lastTs = aligned[aligned.length - 1].bar15m.timestamp;
  const days = Math.round((lastTs - firstTs) / (24 * 60 * 60_000));
  console.log(`[S1-Filter] Window: ${days} days (${new Date(firstTs).toISOString().split("T")[0]} → ${new Date(lastTs).toISOString().split("T")[0]})`);
  console.log(`[S1-Filter] Data loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const results: Array<{ name: string; result: BacktestResult }> = [];

  // A) Baseline — all strategies, Daily-EMA200 required
  console.log("[S1-Filter] Running A: Baseline (Daily-EMA200 required)...");
  S1_CONFIG.requireDailyEma200 = true;
  const allStrategies: StrategyId[] = ["S1", "S2", "S3"];
  const baseline = runVariant("Baseline", aligned, { days, bankroll, marginPct, enabledStrategies: allStrategies });
  results.push({ name: "Baseline", result: baseline });
  console.log(`  → ${baseline.trades.length} trades (S1: ${baseline.stats.byStrategy.S1?.trades ?? 0})\n`);

  // B) No Daily-EMA200 — all strategies, S1 only needs 4H-EMA200
  console.log("[S1-Filter] Running B: No Daily-EMA200 (S1 uses 4H-EMA200 only)...");
  S1_CONFIG.requireDailyEma200 = false;
  const relaxed = runVariant("No Daily-EMA200", aligned, { days, bankroll, marginPct, enabledStrategies: allStrategies });
  results.push({ name: "No Daily-EMA200", result: relaxed });
  console.log(`  → ${relaxed.trades.length} trades (S1: ${relaxed.stats.byStrategy.S1?.trades ?? 0})\n`);

  // C) S1-only baseline — isolate
  console.log("[S1-Filter] Running C: S1-only baseline...");
  S1_CONFIG.requireDailyEma200 = true;
  const s1Only: StrategyId[] = ["S1"];
  const s1Baseline = runVariant("S1-only base", aligned, { days, bankroll, marginPct, enabledStrategies: s1Only });
  results.push({ name: "S1-only base", result: s1Baseline });
  console.log(`  → ${s1Baseline.trades.length} trades\n`);

  // D) S1-only no Daily-EMA200
  console.log("[S1-Filter] Running D: S1-only no Daily-EMA200...");
  S1_CONFIG.requireDailyEma200 = false;
  const s1Relaxed = runVariant("S1-only relaxed", aligned, { days, bankroll, marginPct, enabledStrategies: s1Only });
  results.push({ name: "S1-only relaxed", result: s1Relaxed });
  console.log(`  → ${s1Relaxed.trades.length} trades\n`);

  // Reset to production default
  S1_CONFIG.requireDailyEma200 = true;

  printComparisonTable(results);

  console.log(`[S1-Filter] Total time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(err => {
  console.error("[S1-Filter] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
