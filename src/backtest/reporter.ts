/**
 * Formats and outputs backtest results.
 *
 * Outputs:
 *   1. Rich console table (always)
 *   2. JSON file at project root: backtest-results.json (always)
 *
 * The JSON file can be loaded by a future frontend Backtests page.
 */

import * as fs from "fs";
import * as path from "path";
import type { BacktestResult, BacktestTrade } from "./types";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function pct(n: number, decimals = 1): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}%`;
}

function usd(n: number, decimals = 2): string {
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(decimals)}`;
}

function pad(s: string | number, width: number, right = false): string {
  const str = String(s);
  return right ? str.padStart(width) : str.padEnd(width);
}

function fmtDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 16).replace("T", " ");
}

function fmtDuration(entryMs: number, exitMs: number): string {
  const ms = exitMs - entryMs;
  const h  = Math.floor(ms / 3_600_000);
  const m  = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const LINE = "─".repeat(76);
const DLINE = "═".repeat(76);

// ---------------------------------------------------------------------------
// Console output
// ---------------------------------------------------------------------------

export function printResults(result: BacktestResult): void {
  const { config, trades, stats } = result;

  console.log(`\n${DLINE}`);
  console.log(`  TradingBot Backtest — BTC Perps (Hyperliquid)`);
  console.log(`  Window: ${config.days} days  |  Bankroll: $${config.bankroll.toFixed(2)}  |  Margin/trade: ${(config.marginPct * 100).toFixed(0)}%`);
  console.log(DLINE);

  if (trades.length === 0) {
    console.log("\n  No trades fired during this period.");
    console.log(`  Check: bearish macro (price vs Daily EMA200) may have filtered all signals.\n`);
    return;
  }

  // --- Per-strategy summary ---
  console.log(`\n  ${"Strategy".padEnd(14)} ${"Trades".padStart(6)} ${"Win%".padStart(7)} ${"PnL ($)".padStart(10)} ${"PnL (% bank)".padStart(13)}`);
  console.log(`  ${LINE.slice(0, 54)}`);

  for (const id of ["S1", "S2", "S3"] as const) {
    const s = stats.byStrategy[id];
    if (s.trades === 0) {
      console.log(`  ${"  " + id + " (no trades)".padEnd(12)} ${"—".padStart(6)} ${"—".padStart(7)} ${"—".padStart(10)} ${"—".padStart(13)}`);
      continue;
    }
    const label = { S1: "S1 EMA Trend", S2: "S2 Mean Rev", S3: "S3 Stoch RSI" }[id];
    console.log(
      `  ${pad(label, 14)} ${pad(s.trades, 6, true)} ${pad(pct(s.winRate * 100, 0), 7, true)} ${pad(usd(s.pnlUsd), 10, true)} ${pad(pct((s.pnlUsd / config.bankroll) * 100), 13, true)}`,
    );
  }

  console.log(`  ${LINE.slice(0, 54)}`);
  console.log(
    `  ${"TOTAL".padEnd(14)} ${pad(stats.totalTrades, 6, true)} ${pad(pct(stats.winRate * 100, 0), 7, true)} ${pad(usd(stats.totalPnlUsd), 10, true)} ${pad(pct((stats.totalPnlUsd / config.bankroll) * 100), 13, true)}`,
  );

  // --- Risk metrics ---
  console.log(`\n  ${LINE}`);
  console.log(`  Risk Metrics`);
  console.log(`  ${LINE}`);
  console.log(`  Max Drawdown   ${usd(-stats.maxDrawdownUsd)}  (${pct(-stats.maxDrawdownPct)})`);
  console.log(`  Profit Factor  ${stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}`);
  console.log(`  Avg Win / Loss ${usd(stats.avgWinUsd)} / ${usd(-stats.avgLossUsd)}`);
  console.log(`  Avg R-Multiple ${stats.avgRMultiple >= 0 ? "+" : ""}${stats.avgRMultiple.toFixed(2)}R`);
  if (stats.sharpeRatio !== null) {
    console.log(`  Sharpe (ann.)  ${stats.sharpeRatio.toFixed(2)}`);
  }

  // --- Last 15 trades ---
  const recent = trades.slice(-15);
  console.log(`\n  ${LINE}`);
  console.log(`  Recent Trades (last ${recent.length})`);
  console.log(`  ${LINE}`);
  console.log(
    `  ${"Date (entry)".padEnd(16)} ${"St".padEnd(4)} ${"Dir".padEnd(6)} ${"Lev".padStart(4)} ${"Entry".padStart(9)} ${"Exit".padStart(9)} ${"PnL ($)".padStart(9)} ${"Reason".padEnd(22)}`,
  );
  console.log(`  ${LINE}`);

  for (const t of recent) {
    const pnlStr = t.pnlUsd >= 0 ? `+$${t.pnlUsd.toFixed(2)}` : `-$${Math.abs(t.pnlUsd).toFixed(2)}`;
    console.log(
      `  ${fmtDate(t.entryTimestamp).padEnd(16)} ${t.strategy.padEnd(4)} ${t.direction.padEnd(6)} ${String(t.leverage + "x").padStart(4)} ${t.entryPrice.toFixed(0).padStart(9)} ${t.exitPrice.toFixed(0).padStart(9)} ${pnlStr.padStart(9)} ${t.exitReason}`,
    );
  }

  // --- Caveats ---
  console.log(`\n  ${LINE}`);
  console.log(`  Notes`);
  console.log(`  ${LINE}`);
  console.log(`  • SL/TP hits detected using bar high/low (not tick data)`);
  console.log(`  • S3 TPs: full position exits at highest TP level reached in bar`);
  console.log(`    (real bot uses 33/33/34% partial closes at +1%/+3%/+5%)`);
  console.log(`  • BBWP/PMARP use default TV params — may differ if chart settings differ`);
  console.log(`  • Confluence macro filter applied (matches live bot behaviour)`);
  console.log(`  • Fee: 0.035% taker × 2 sides deducted per trade`);
  console.log(`  • One position at a time (no concurrent positions)`);
  console.log(`${DLINE}\n`);
}

// ---------------------------------------------------------------------------
// JSON save
// ---------------------------------------------------------------------------

export function saveResultsToFile(result: BacktestResult): string {
  const serialisable = {
    ...result,
    generatedAt: new Date().toISOString(),
    trades: result.trades.map((t: BacktestTrade) => ({
      ...t,
      entryDate: new Date(t.entryTimestamp).toISOString(),
      exitDate:  new Date(t.exitTimestamp).toISOString(),
      duration:  fmtDuration(t.entryTimestamp, t.exitTimestamp),
    })),
  };

  const json = JSON.stringify(serialisable, null, 2);

  // ── Save to backtest-results/ directory (one file per run) ──────────────
  const dir = path.join(process.cwd(), "backtest-results");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  const now  = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");            // 20260414
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "");            // 132500
  const filename = `${result.config.days}d-${date}-${time}.json`;
  const runPath = path.join(dir, filename);
  fs.writeFileSync(runPath, json);

  // ── Also keep backtest-results.json for backward compat ─────────────────
  const legacyPath = path.join(process.cwd(), "backtest-results.json");
  fs.writeFileSync(legacyPath, json);

  return runPath;
}
