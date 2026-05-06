/**
 * S4 Grid strategy backtest — CLI entry point.
 *
 * Usage:
 *   npx ts-node src/scripts/backtest_grid.ts
 *   npx ts-node src/scripts/backtest_grid.ts --bankroll 500 --levels 5 --spacing 0.5
 *   npx ts-node src/scripts/backtest_grid.ts --leverage 3 --no-regime --no-vol-adaptive
 *
 * Flags:
 *   --bankroll <n>       Starting bankroll in USD (default: 500)
 *   --data-dir <path>    Path to Binance CSV directory (default: ./data/bt-data)
 *   --levels <n>         Grid levels per side (default: 5)
 *   --spacing <n>        Base spacing as % (default: 0.5)
 *   --margin-per-level <n>  Margin per level as % of bankroll (default: 1)
 *   --leverage <n>       Leverage multiplier (default: 3)
 *   --no-regime          Disable regime filter
 *   --no-vol-adaptive    Disable volatility-adaptive spacing
 */

import * as path from "path";
import * as fs from "fs";
import { loadBinanceData } from "../backtest/binance-loader";
import { alignBars } from "../backtest/aligner";
import { runGridBacktest, type GridBacktestResult } from "../backtest/grid-engine";
import { DEFAULT_GRID_CONFIG, type GridConfig } from "../strategy/s4_grid";

// ── Arg parsing ─────────────────────────────────────────────────

function getFlag(name: string, defaultVal: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : defaultVal;
}

function getNumFlag(name: string, defaultVal: number, allowZero = false): number {
  const raw = getFlag(name, String(defaultVal));
  const n = parseFloat(raw);
  return Number.isFinite(n) && (allowZero ? n >= 0 : n > 0) ? n : defaultVal;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

// ── Formatting helpers ──────────────────────────────────────────

function usd(n: number): string {
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;
}

function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 16).replace("T", " ");
}

const LINE = "\u2500".repeat(58);
const DLINE = "\u2550".repeat(62);

// ── Console output ──────────────────────────────────────────────

function printGridResults(result: GridBacktestResult): void {
  const { config, trades, stats, dateRange } = result;
  const { grid } = config;

  console.log(`\n${DLINE}`);
  console.log(`  S4 Grid Strategy Backtest \u2014 BTC Perps (Hyperliquid)`);
  console.log(`  Window: ${dateRange.days} days (${dateRange.from} \u2192 ${dateRange.to})`);
  console.log(`  Bankroll: $${config.bankroll.toFixed(2)}  |  Levels: ${grid.levelsPerSide}/side`);
  console.log(`  Spacing: ${(grid.baseSpacingPct * 100).toFixed(1)}%${grid.volatilityAdaptive ? " (vol-adaptive)" : " (fixed)"}  |  Leverage: ${grid.leverage}x  |  Margin/level: ${(grid.marginPctPerLevel * 100).toFixed(0)}%`);
  console.log(DLINE);

  if (trades.length === 0) {
    console.log("\n  No trades fired during this period.\n");
    return;
  }

  // ── Performance ───────────────────────────────────────────────
  console.log(`\n  Performance`);
  console.log(`  ${LINE}`);
  console.log(`  Net PnL          ${usd(stats.netPnl).padStart(12)}  (${pct(stats.netPnlPct)} of bankroll)`);
  console.log(`  Win Rate         ${(stats.winRate * 100).toFixed(1).padStart(11)}%  (${stats.winners}W / ${stats.losers}L)`);
  console.log(`  Profit Factor    ${(stats.profitFactor === Infinity ? "\u221E" : stats.profitFactor.toFixed(2)).padStart(12)}`);
  console.log(`  Max Drawdown     ${usd(-stats.maxDrawdownUsd).padStart(12)}  (${pct(-stats.maxDrawdownPct)})`);
  if (stats.sharpeRatio !== null) {
    console.log(`  Sharpe (ann.)    ${stats.sharpeRatio.toFixed(2).padStart(12)}`);
  }
  console.log(`  Avg Win / Loss   ${usd(stats.avgWin).padStart(12)} / ${usd(-stats.avgLoss)}`);

  // ── Cost Breakdown ────────────────────────────────────────────
  console.log(`\n  Cost Breakdown`);
  console.log(`  ${LINE}`);
  console.log(`  Gross Round-Trip P&L  ${usd(stats.grossRoundTripPnl).padStart(12)}`);
  console.log(`  Trading Fees          ${usd(-stats.totalFees).padStart(12)}`);
  console.log(`  Long-Side Funding     ${usd(-stats.longFundingPaid).padStart(12)}`);
  console.log(`  Short-Side Funding    ${usd(-stats.shortFundingPaid).padStart(12)}`);
  console.log(`  Recenter Losses       ${usd(-stats.recenterLosses).padStart(12)}`);
  console.log(`  ${LINE}`);
  console.log(`  Net P&L               ${usd(stats.netPnl).padStart(12)}`);

  // ── Grid Activity ─────────────────────────────────────────────
  const totalCells = grid.levelsPerSide * 2;
  console.log(`\n  Grid Activity`);
  console.log(`  ${LINE}`);
  console.log(`  Round-Trips           ${String(stats.totalRoundTrips).padStart(12)}`);
  console.log(`  Avg Round-Trip Time   ${fmtDuration(stats.avgRoundTripTimeMs).padStart(12)}`);
  console.log(`  Max Inventory         ${`${stats.maxInventory} / ${totalCells} cells`.padStart(12)}`);
  console.log(`  Recenters             ${String(stats.recenterCount).padStart(12)}`);
  console.log(`  Momentum Pauses       ${String(stats.momentumPauses).padStart(12)}`);
  console.log(`  Regime Pauses         ${String(stats.regimePauses).padStart(12)}`);
  console.log(`  Grid Uptime           ${`${stats.gridUptimePct.toFixed(1)}%`.padStart(12)}`);

  // ── Comparison ────────────────────────────────────────────────
  console.log(`\n  Comparison (same bankroll, same period)`);
  console.log(`  ${LINE}`);
  console.log(`  S4 Grid:     ${usd(stats.netPnl).padStart(10)}  (${pct(stats.netPnlPct)})`);
  console.log(`  S3 Scalp:     -$82.00  (-16.4%)  [379-day reference]`);
  console.log(`  Do Nothing:    $0.00   ( 0.0%)`);

  // ── Recent Trades ─────────────────────────────────────────────
  const recent = trades.slice(-15);
  console.log(`\n  Recent Trades (last ${recent.length} of ${trades.length})`);
  console.log(`  ${LINE}`);
  console.log(`  ${"Entry".padEnd(16)} ${"Exit".padEnd(16)} ${"Entry$".padStart(8)} ${"Exit$".padStart(8)} ${"Net".padStart(8)} ${"Reason"}`);
  console.log(`  ${LINE}`);

  for (const t of recent) {
    console.log(
      `  ${fmtDate(t.entryTime).padEnd(16)} ${fmtDate(t.exitTime).padEnd(16)} ${t.entryPrice.toFixed(0).padStart(8)} ${t.exitPrice.toFixed(0).padStart(8)} ${usd(t.netPnl).padStart(8)} ${t.exitReason}`,
    );
  }

  // ── Notes ─────────────────────────────────────────────────────
  console.log(`\n  ${LINE}`);
  console.log(`  Notes`);
  console.log(`  ${LINE}`);
  console.log(`  \u2022 Fill detection uses bar high/low (not tick data)`);
  console.log(`  \u2022 Fee: ${(grid.feePct * 100).toFixed(3)}% per side (${(grid.feePct * 200).toFixed(3)}% round-trip)`);
  console.log(`  \u2022 Funding: ${(grid.hourlyFundingRate * 100).toFixed(5)}%/hr applied to long positions`);
  console.log(`  \u2022 Sells processed before buys each bar (conservative)`);
  console.log(`  \u2022 Position size compounds with equity`);
  console.log(`${DLINE}\n`);
}

// ── JSON save ───────────────────────────────────────────────────

function saveResults(result: GridBacktestResult): string {
  const dir = path.join(process.cwd(), "backtest-results");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
  const filename = `grid-${result.dateRange.days}d-${date}-${time}.json`;
  const filePath = path.join(dir, filename);

  const serializable = {
    ...result,
    generatedAt: now.toISOString(),
    trades: result.trades.map(t => ({
      ...t,
      entryDate: new Date(t.entryTime).toISOString(),
      exitDate: new Date(t.exitTime).toISOString(),
      duration: fmtDuration(t.exitTime - t.entryTime),
    })),
  };

  fs.writeFileSync(filePath, JSON.stringify(serializable, null, 2));
  return filePath;
}

// ── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const bankroll = getNumFlag("bankroll", 500);
  const dataDir = getFlag("data-dir", path.resolve(process.cwd(), "data/bt-data"));

  const grid: GridConfig = {
    ...DEFAULT_GRID_CONFIG,
    levelsPerSide: getNumFlag("levels", DEFAULT_GRID_CONFIG.levelsPerSide),
    baseSpacingPct: getNumFlag("spacing", DEFAULT_GRID_CONFIG.baseSpacingPct * 100) / 100,
    marginPctPerLevel: getNumFlag("margin-per-level", DEFAULT_GRID_CONFIG.marginPctPerLevel * 100) / 100,
    leverage: getNumFlag("leverage", DEFAULT_GRID_CONFIG.leverage),
    regimeFilter: !hasFlag("no-regime"),
    volatilityAdaptive: !hasFlag("no-vol-adaptive"),
    recenterBarsThreshold: getNumFlag("recenter-bars", DEFAULT_GRID_CONFIG.recenterBarsThreshold),
    recenterDailyCap: getNumFlag("recenter-cap", DEFAULT_GRID_CONFIG.recenterDailyCap, true),
  };

  console.log(`\n[Grid-Backtest] Starting S4 grid backtest`);
  console.log(`[Grid-Backtest] Bankroll: $${bankroll} | Levels: ${grid.levelsPerSide}/side | Spacing: ${(grid.baseSpacingPct * 100).toFixed(1)}%${grid.volatilityAdaptive ? " (vol-adaptive)" : ""}`);
  console.log(`[Grid-Backtest] Leverage: ${grid.leverage}x | Margin/level: ${(grid.marginPctPerLevel * 100).toFixed(0)}% | Fee: ${(grid.feePct * 100).toFixed(3)}%/side`);
  console.log(`[Grid-Backtest] Regime filter: ${grid.regimeFilter ? "ON" : "OFF"} | Momentum detector: ${grid.momentumThreshold} fills/${grid.momentumWindowMs / 60_000}min`);
  console.log(`[Grid-Backtest] Data dir: ${dataDir}\n`);

  const t0 = Date.now();

  // Load + aggregate + compute indicators
  const collected = await loadBinanceData(dataDir, 700);
  console.log(`[Grid-Backtest] Data loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Align
  const aligned = alignBars(
    collected.bars15m,
    collected.bars1H,
    collected.bars4H,
    collected.bars1D,
    collected.backtestStartMs,
  );
  console.log(`[Grid-Backtest] Aligned bars: ${aligned.length}`);

  if (aligned.length === 0) {
    console.error("[Grid-Backtest] No aligned bars — check data directory.");
    process.exit(1);
  }

  const firstTs = aligned[0].bar15m.timestamp;
  const lastTs = aligned[aligned.length - 1].bar15m.timestamp;
  const days = Math.round((lastTs - firstTs) / 86_400_000);
  console.log(`[Grid-Backtest] Window: ${days} days (${new Date(firstTs).toISOString().split("T")[0]} \u2192 ${new Date(lastTs).toISOString().split("T")[0]})`);

  // Run
  console.log(`[Grid-Backtest] Running grid simulation...`);
  const result = runGridBacktest(aligned, collected.bars1D, { bankroll, grid });
  console.log(`[Grid-Backtest] Simulation complete \u2014 ${result.trades.length} trades`);

  // Output
  printGridResults(result);
  const outPath = saveResults(result);
  console.log(`[Grid-Backtest] Results saved to: ${outPath}`);

  // Decision gate
  console.log("\n=== DECISION GATE ===");
  const { stats } = result;
  const viable = stats.netPnl > 0 && stats.totalRoundTrips >= 20;
  console.log(`  Round-trips: ${stats.totalRoundTrips}`);
  console.log(`  Net PnL: ${usd(stats.netPnl)} (${pct(stats.netPnlPct)})`);
  console.log(`  Funding drag: ${usd(-stats.longFundingPaid)} (long-side only)`);
  console.log(`  Profit factor: ${stats.profitFactor === Infinity ? "\u221E" : stats.profitFactor.toFixed(2)}`);
  console.log(`  Max DD: ${usd(-stats.maxDrawdownUsd)} (${pct(-stats.maxDrawdownPct)})`);

  if (!viable) {
    if (stats.totalRoundTrips < 20) {
      console.log(`\n  RESULT: INSUFFICIENT DATA (<20 round-trips). Adjust parameters or extend data window.`);
    } else {
      console.log(`\n  RESULT: NEGATIVE EXPECTANCY. Grid not viable with these parameters.`);
      console.log(`  \u2192 Consider: wider spacing, fewer levels, regime filter tuning.`);
    }
  } else {
    console.log(`\n  RESULT: POSITIVE EXPECTANCY \u2014 grid strategy viable.`);
    console.log(`  \u2192 Next: paper-trade 24-48h on Hyperliquid before live deployment.`);
  }
  console.log("");
}

main().catch(err => {
  console.error("[Grid-Backtest] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
