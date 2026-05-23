/**
 * Trailing SL A/B/C backtest: baseline vs breakeven vs trailing.
 *
 * Loads data once, runs S1+S6 at all three trailing modes with actual
 * Binance funding rates. Compares PnL, win rate, drawdown, and SL moves.
 *
 * Uses bar high (long) / bar low (short) as conservative mark price for
 * trailing evaluation. If trailing tightens SL and the same bar's adverse
 * price hits the new SL, the position exits at the trailing SL.
 *
 * Usage:
 *   npx ts-node src/scripts/backtest_trailing.ts
 *   npx ts-node src/scripts/backtest_trailing.ts --bankroll 500 --margin 5
 *   npx ts-node src/scripts/backtest_trailing.ts --distance 0.02 --buffer 0.001
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as path from "path";
import { loadBinanceData } from "../backtest/binance-loader";
import { alignBars } from "../backtest/aligner";
import { runBacktest } from "../backtest/engine";
import { loadFundingRates } from "../backtest/funding-loader";
import type { BacktestConfig, BacktestResult, BacktestStats, StrategyId } from "../backtest/types";
import type { TrailingMode } from "../risk/trailing";

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

function pad(s: string, w: number): string {
  return s.padStart(w);
}

function printThreeWay(
  results: Record<"off" | "breakeven" | "trailing", BacktestResult>,
): void {
  const b = results.off.stats;
  const be = results.breakeven.stats;
  const tr = results.trailing.stats;

  const W = 16;
  const header = `  ${"".padEnd(22)} ${pad("Baseline", W)} ${pad("Breakeven", W)} ${pad("Trailing", W)}`;
  const sep = `  ${"─".repeat(22 + (W + 1) * 3)}`;

  console.log(header);
  console.log(sep);

  const rows: Array<[string, (s: BacktestStats) => string]> = [
    ["Total Trades",   s => String(s.totalTrades)],
    ["Winners",        s => String(s.winners)],
    ["Losers",         s => String(s.losers)],
    ["Win Rate",       s => `${(s.winRate * 100).toFixed(1)}%`],
    ["Total PnL",      s => fmtUsd(s.totalPnlUsd)],
    ["Profit Factor",  s => s.profitFactor.toFixed(2)],
    ["Max Drawdown",   s => `${s.maxDrawdownPct.toFixed(1)}%`],
    ["Avg Win",        s => fmtUsd(s.avgWinUsd)],
    ["Avg Loss",       s => `-$${s.avgLossUsd.toFixed(2)}`],
    ["Avg R-Multiple", s => s.avgRMultiple.toFixed(2)],
    ["Sharpe",         s => s.sharpeRatio?.toFixed(2) ?? "N/A"],
  ];

  for (const [label, fn] of rows) {
    console.log(`  ${label.padEnd(22)} ${pad(fn(b), W)} ${pad(fn(be), W)} ${pad(fn(tr), W)}`);
  }

  // Trailing-specific metrics
  console.log(sep);
  console.log(`  ${"SL Moves".padEnd(22)} ${pad("—", W)} ${pad(String(results.breakeven.trailingSlMoves ?? 0), W)} ${pad(String(results.trailing.trailingSlMoves ?? 0), W)}`);

  // Funding costs
  const fundingFor = (r: BacktestResult) => r.trades.reduce((s, t) => s + t.fundingPnl, 0);
  console.log(`  ${"Funding Cost".padEnd(22)} ${pad(fmtUsd(fundingFor(results.off)), W)} ${pad(fmtUsd(fundingFor(results.breakeven)), W)} ${pad(fmtUsd(fundingFor(results.trailing)), W)}`);
}

function printPerStrategy(
  results: Record<"off" | "breakeven" | "trailing", BacktestResult>,
): void {
  const W = 16;
  console.log(`\n  Per-Strategy Breakdown:`);
  for (const id of ["S1", "S6"] as StrategyId[]) {
    const bS = results.off.stats.byStrategy[id];
    const beS = results.breakeven.stats.byStrategy[id];
    const trS = results.trailing.stats.byStrategy[id];
    if (bS.trades === 0) continue;

    console.log(`\n  ${id}:`);
    console.log(`  ${"".padEnd(22)} ${pad("Baseline", W)} ${pad("Breakeven", W)} ${pad("Trailing", W)}`);
    console.log(`  ${"─".repeat(22 + (W + 1) * 3)}`);
    console.log(`  ${"Trades".padEnd(22)} ${pad(String(bS.trades), W)} ${pad(String(beS.trades), W)} ${pad(String(trS.trades), W)}`);
    console.log(`  ${"Win Rate".padEnd(22)} ${pad(`${(bS.winRate * 100).toFixed(1)}%`, W)} ${pad(`${(beS.winRate * 100).toFixed(1)}%`, W)} ${pad(`${(trS.winRate * 100).toFixed(1)}%`, W)}`);
    console.log(`  ${"PnL".padEnd(22)} ${pad(fmtUsd(bS.pnlUsd), W)} ${pad(fmtUsd(beS.pnlUsd), W)} ${pad(fmtUsd(trS.pnlUsd), W)}`);
  }
}

function printExitReasonBreakdown(
  results: Record<"off" | "breakeven" | "trailing", BacktestResult>,
): void {
  const W = 16;
  console.log(`\n  Exit Reason Breakdown:`);
  console.log(`  ${"".padEnd(22)} ${pad("Baseline", W)} ${pad("Breakeven", W)} ${pad("Trailing", W)}`);
  console.log(`  ${"─".repeat(22 + (W + 1) * 3)}`);

  const reasons = new Set<string>();
  for (const mode of ["off", "breakeven", "trailing"] as const) {
    for (const t of results[mode].trades) reasons.add(t.exitReason);
  }

  for (const reason of [...reasons].sort()) {
    const counts = (["off", "breakeven", "trailing"] as const).map(
      mode => results[mode].trades.filter(t => t.exitReason === reason).length,
    );
    console.log(`  ${reason.padEnd(22)} ${pad(String(counts[0]), W)} ${pad(String(counts[1]), W)} ${pad(String(counts[2]), W)}`);
  }
}

async function main(): Promise<void> {
  const bankroll = getNumFlag("bankroll", 500);
  const marginPct = getNumFlag("margin", 5) / 100;
  const trailingDistance = getNumFlag("distance", 2) / 100;
  const breakevenBuffer = getNumFlag("buffer", 0.1) / 100;
  const dataDir = getFlag("data-dir", path.resolve(process.cwd(), "data/bt-data"));
  const indicatorParams = { pmarpPeriod: 20, pmarpLookback: 350 };
  const enabledStrategies: StrategyId[] = ["S1", "S6"];

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  TRAILING SL A/B/C BACKTEST`);
  console.log(`${"═".repeat(70)}`);
  console.log(`  Bankroll: $${bankroll} | Margin: ${(marginPct * 100).toFixed(0)}%`);
  console.log(`  Strategies: ${enabledStrategies.join(", ")}`);
  console.log(`  Trailing distance: ${(trailingDistance * 100).toFixed(1)}% | Breakeven buffer: ${(breakevenBuffer * 100).toFixed(2)}%`);
  console.log(`  Mark price: bar HIGH (long) / bar LOW (short) — conservative`);
  console.log(`  Fees: 0.045% taker × 2 = 0.09% RT | Funding: actual Binance rates\n`);

  const t0 = Date.now();

  // Load data once
  const collected = await loadBinanceData(dataDir, 700, indicatorParams);

  // Load funding rates
  const fundingPath = path.resolve(dataDir, "BTCUSDT-funding.csv");
  const fundingRates = loadFundingRates(fundingPath);

  const aligned = alignBars(
    collected.bars15m, collected.bars1H, collected.bars4H, collected.bars1D,
    collected.backtestStartMs,
  );
  console.log(`  Data loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${aligned.length} aligned bars`);

  const firstTs = aligned[0].bar15m.timestamp;
  const lastTs = aligned[aligned.length - 1].bar15m.timestamp;
  const days = Math.round((lastTs - firstTs) / (24 * 60 * 60_000));
  console.log(`  Window: ${days} days (${new Date(firstTs).toISOString().split("T")[0]} → ${new Date(lastTs).toISOString().split("T")[0]})\n`);

  const modes: Array<"off" | "breakeven" | "trailing"> = ["off", "breakeven", "trailing"];
  const results = {} as Record<"off" | "breakeven" | "trailing", BacktestResult>;

  for (const mode of modes) {
    const config: BacktestConfig = {
      days,
      bankroll,
      marginPct,
      enabledStrategies,
      fundingRates,
      trailingMode: mode as TrailingMode,
      trailingDistance,
      breakevenBuffer,
    };
    results[mode] = runBacktest(aligned, config);
    console.log(`  ${mode.padEnd(10)} — ${results[mode].trades.length} trades, ${fmtUsd(results[mode].stats.totalPnlUsd)} PnL, ${results[mode].trailingSlMoves ?? 0} SL moves`);
  }

  // Print comparison
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  COMPARISON`);
  console.log(`${"═".repeat(70)}\n`);

  printThreeWay(results);
  printPerStrategy(results);
  printExitReasonBreakdown(results);

  // Verdict
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  VERDICT`);
  console.log(`${"═".repeat(70)}\n`);

  const pnls = modes.map(m => ({ mode: m, pnl: results[m].stats.totalPnlUsd }));
  pnls.sort((a, b) => b.pnl - a.pnl);
  const best = pnls[0];

  for (const { mode, pnl } of pnls) {
    const delta = pnl - results.off.stats.totalPnlUsd;
    const marker = mode === best.mode ? " ← BEST" : "";
    console.log(`  ${mode.padEnd(10)} ${fmtUsd(pnl).padStart(10)}  (Δ ${fmtUsd(delta)})${marker}`);
  }

  const bestDD = results[best.mode].stats.maxDrawdownPct;
  const baseDD = results.off.stats.maxDrawdownPct;
  console.log(`\n  Best mode: ${best.mode}`);
  console.log(`  PnL improvement: ${fmtUsd(best.pnl - results.off.stats.totalPnlUsd)} vs baseline`);
  console.log(`  Drawdown: ${bestDD.toFixed(1)}% (baseline ${baseDD.toFixed(1)}%)`);

  if (best.mode === "off") {
    console.log(`\n  → Trailing SL does not improve this strategy set on this data.`);
    console.log(`  → Keep TRAILING_MODE=off on VPS.`);
  } else {
    console.log(`\n  → Recommend: TRAILING_MODE=${best.mode} on VPS.`);
    console.log(`  → Set in VPS .env + pm2 restart trading-bot.`);
  }

  console.log("");
}

main().catch(err => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
