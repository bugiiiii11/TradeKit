/**
 * S6 BBWP Breakout — standalone backtest.
 *
 * Usage:
 *   npx ts-node src/scripts/backtest_s6.ts
 *   npx ts-node src/scripts/backtest_s6.ts --bankroll 500 --leverage 8
 *   npx ts-node src/scripts/backtest_s6.ts --timeframe 1H
 *
 * Flags:
 *   --bankroll <n>      Starting bankroll (default: 500)
 *   --margin <n>        Margin per trade as % (default: 5)
 *   --leverage <n>      Leverage (default: 8)
 *   --data-dir <path>   Binance CSV directory (default: ./data/bt-data)
 *   --timeframe <tf>    Signal timeframe: 4H or 1H (default: 4H)
 */

import * as path from "path";
import * as fs from "fs";
import { loadBinanceData } from "../backtest/binance-loader";
import { alignBars } from "../backtest/aligner";
import type { AlignedBar, BarData, BacktestTrade, Direction } from "../backtest/types";
import {
  evaluateS6,
  shouldExitS6,
  resetS6State,
  resetS6ExitState,
  S6_STOP_DISTANCE,
} from "../strategy/s6_bbwp_breakout";

// ── Constants ───────────────────────────────────────────────────

const TAKER_FEE = 0.00045;
const HOURLY_FUNDING_RATE = 0.0000125;
const MS_PER_HOUR = 3_600_000;

// ── Arg parsing ─────────────────────────────────────────────────

function getFlag(name: string, defaultVal: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : defaultVal;
}

function getNumFlag(name: string, defaultVal: number): number {
  const raw = getFlag(name, String(defaultVal));
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

// ── Formatting ──────────────────────────────────────────────────

function usd(n: number): string {
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;
}

function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const LINE = "\u2500".repeat(62);
const DLINE = "\u2550".repeat(66);

// ── Open position type ──────────────────────────────────────────

interface Position {
  direction: Direction;
  entryPrice: number;
  entryTimestamp: number;
  leverage: number;
  marginUsd: number;
  notionalUsd: number;
  stopPrice: number;
  accFunding: number;
}

// ── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const bankroll = getNumFlag("bankroll", 500);
  const marginPct = getNumFlag("margin", 5) / 100;
  const leverage = getNumFlag("leverage", 8);
  const dataDir = getFlag("data-dir", path.resolve(process.cwd(), "data/bt-data"));
  const tf = getFlag("timeframe", "4H") as "4H" | "1H";

  console.log(`\n[S6-Backtest] BBWP Volatility Breakout`);
  console.log(`[S6-Backtest] Bankroll: $${bankroll} | Margin: ${(marginPct * 100).toFixed(0)}% | Leverage: ${leverage}x`);
  console.log(`[S6-Backtest] Signal TF: ${tf} | Stop: ${(S6_STOP_DISTANCE * 100).toFixed(0)}%`);
  console.log(`[S6-Backtest] Data dir: ${dataDir}\n`);

  const t0 = Date.now();
  const collected = await loadBinanceData(dataDir, 700, { pmarpPeriod: 20, pmarpLookback: 350 });
  console.log(`[S6-Backtest] Data loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const aligned = alignBars(
    collected.bars15m, collected.bars1H, collected.bars4H, collected.bars1D,
    collected.backtestStartMs,
  );
  console.log(`[S6-Backtest] Aligned bars: ${aligned.length}`);

  if (aligned.length === 0) {
    console.error("[S6-Backtest] No aligned bars.");
    process.exit(1);
  }

  const firstTs = aligned[0].bar15m.timestamp;
  const lastTs = aligned[aligned.length - 1].bar15m.timestamp;
  const days = Math.round((lastTs - firstTs) / 86_400_000);
  console.log(`[S6-Backtest] Window: ${days} days (${new Date(firstTs).toISOString().split("T")[0]} \u2192 ${new Date(lastTs).toISOString().split("T")[0]})`);
  console.log(`[S6-Backtest] Running...\n`);

  // ── Engine state ──────────────────────────────────────────────

  resetS6State();
  resetS6ExitState();

  let equity = bankroll;
  let peakEquity = bankroll;
  let maxDdUsd = 0;
  let maxDdPct = 0;

  const trades: BacktestTrade[] = [];
  const equityCurve: Array<{ timestamp: number; equity: number }> = [{ timestamp: firstTs, equity }];

  let pos: Position | null = null;
  let lastFundingHour = -1;
  let prevSignalBarTs = 0; // track 4H or 1H bar changes
  let cooldownUntil = 0;

  // ── Main loop ─────────────────────────────────────────────────

  for (const ab of aligned) {
    const bar15m = ab.bar15m;
    const signalBar: BarData = tf === "4H" ? ab.bar4H : ab.bar1H;
    const ts = bar15m.timestamp;

    // Funding (hourly)
    if (pos) {
      const hour = Math.floor(ts / MS_PER_HOUR);
      if (hour !== lastFundingHour) {
        const dirMult = pos.direction === "long" ? 1 : -1;
        pos.accFunding += pos.notionalUsd * HOURLY_FUNDING_RATE * dirMult;
        lastFundingHour = hour;
      }
    }

    // SL check (every 15m bar)
    if (pos) {
      let slHit = false;
      if (pos.direction === "long" && bar15m.low <= pos.stopPrice) slHit = true;
      if (pos.direction === "short" && bar15m.high >= pos.stopPrice) slHit = true;

      if (slHit) {
        const trade = closeTrade(pos, pos.stopPrice, ts, "stop_loss");
        trades.push(trade);
        equity += trade.pnlUsd;
        equityCurve.push({ timestamp: ts, equity });
        cooldownUntil = ts + 5 * (tf === "4H" ? 4 : 1) * MS_PER_HOUR;
        pos = null;
      }
    }

    // Signal bar change detection
    if (signalBar.timestamp === prevSignalBarTs) continue;
    prevSignalBarTs = signalBar.timestamp;

    // Exit check (on signal TF bar change)
    if (pos) {
      const exitResult = shouldExitS6(
        { bbwp: signalBar.bbwp, ema8: signalBar.ema8, ema55: signalBar.ema55 },
        pos.direction,
      );
      if (exitResult.exit) {
        const trade = closeTrade(pos, bar15m.close, ts, exitResult.reason);
        trades.push(trade);
        equity += trade.pnlUsd;
        equityCurve.push({ timestamp: ts, equity });
        cooldownUntil = ts + 5 * (tf === "4H" ? 4 : 1) * MS_PER_HOUR;
        pos = null;
      }
    }

    // Entry check (on signal TF bar change, no open position, past cooldown)
    if (!pos && ts >= cooldownUntil) {
      const signal = evaluateS6({
        bbwp: signalBar.bbwp,
        close: signalBar.close,
        ema21: signalBar.ema21,
      });

      if (signal) {
        const margin = equity * marginPct;
        const notional = margin * leverage;
        const entry = bar15m.close;
        const stopMult = signal.direction === "long" ? (1 - S6_STOP_DISTANCE) : (1 + S6_STOP_DISTANCE);

        pos = {
          direction: signal.direction,
          entryPrice: entry,
          entryTimestamp: ts,
          leverage,
          marginUsd: margin,
          notionalUsd: notional,
          stopPrice: entry * stopMult,
          accFunding: 0,
        };
        lastFundingHour = -1;
        resetS6ExitState();
      }
    } else if (!pos) {
      // Still need to advance S6 state even when we can't enter
      evaluateS6({
        bbwp: signalBar.bbwp,
        close: signalBar.close,
        ema21: signalBar.ema21,
      });
    }

    // Drawdown tracking
    const mtm = pos
      ? equity + pos.notionalUsd * ((bar15m.close - pos.entryPrice) / pos.entryPrice) * (pos.direction === "long" ? 1 : -1) - pos.notionalUsd * TAKER_FEE * 2 - pos.accFunding
      : equity;
    if (mtm > peakEquity) peakEquity = mtm;
    const dd = peakEquity - mtm;
    if (dd > maxDdUsd) { maxDdUsd = dd; maxDdPct = peakEquity > 0 ? dd / peakEquity : 0; }
  }

  // Close remaining position
  if (pos) {
    const lastPrice = aligned[aligned.length - 1].bar15m.close;
    const trade = closeTrade(pos, lastPrice, lastTs, "end_of_data");
    trades.push(trade);
    equity += trade.pnlUsd;
  }

  // ── Stats ─────────────────────────────────────────────────────

  const winners = trades.filter(t => t.pnlUsd > 0);
  const losers = trades.filter(t => t.pnlUsd <= 0);
  const grossWin = winners.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnlUsd, 0));
  const winRate = trades.length > 0 ? winners.length / trades.length : 0;
  const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const totalFunding = trades.reduce((s, t) => s + t.fundingPnl, 0);

  // Sharpe
  const dailyEquities: number[] = [bankroll];
  let lastDay = 0;
  for (const pt of equityCurve) {
    const day = Math.floor(pt.timestamp / 86_400_000);
    if (day !== lastDay) { dailyEquities.push(pt.equity); lastDay = day; }
  }
  dailyEquities.push(equity);
  let sharpe: number | null = null;
  if (dailyEquities.length >= 10) {
    const rets = [];
    for (let i = 1; i < dailyEquities.length; i++) {
      if (dailyEquities[i - 1] > 0) rets.push((dailyEquities[i] - dailyEquities[i - 1]) / dailyEquities[i - 1]);
    }
    if (rets.length >= 10) {
      const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
      const std = Math.sqrt(rets.reduce((s, r) => s + (r - avg) ** 2, 0) / rets.length);
      if (std > 0) sharpe = (avg / std) * Math.sqrt(252);
    }
  }

  // ── Output ────────────────────────────────────────────────────

  const netPnl = equity - bankroll;
  const netPnlPct = (netPnl / bankroll) * 100;

  console.log(DLINE);
  console.log(`  S6 BBWP Breakout Backtest \u2014 BTC Perps (Hyperliquid)`);
  console.log(`  Window: ${days} days | Bankroll: $${bankroll} | Leverage: ${leverage}x | TF: ${tf}`);
  console.log(`  Stop: ${(S6_STOP_DISTANCE * 100).toFixed(0)}% | Margin: ${(marginPct * 100).toFixed(0)}% | Fee: ${(TAKER_FEE * 100).toFixed(3)}%/side`);
  console.log(DLINE);

  if (trades.length === 0) {
    console.log("\n  No trades fired.\n");
    return;
  }

  console.log(`\n  Performance`);
  console.log(`  ${LINE}`);
  console.log(`  Net PnL          ${usd(netPnl).padStart(12)}  (${pct(netPnlPct)} of bankroll)`);
  console.log(`  Trades           ${String(trades.length).padStart(12)}  (${winners.length}W / ${losers.length}L)`);
  console.log(`  Win Rate         ${(winRate * 100).toFixed(1).padStart(11)}%`);
  console.log(`  Profit Factor    ${(pf === Infinity ? "\u221E" : pf.toFixed(2)).padStart(12)}`);
  console.log(`  Max Drawdown     ${usd(-maxDdUsd).padStart(12)}  (${pct(-maxDdPct * 100)})`);
  if (sharpe !== null) console.log(`  Sharpe (ann.)    ${sharpe.toFixed(2).padStart(12)}`);
  console.log(`  Avg Win          ${usd(winners.length > 0 ? grossWin / winners.length : 0).padStart(12)}`);
  console.log(`  Avg Loss         ${usd(-(losers.length > 0 ? grossLoss / losers.length : 0)).padStart(12)}`);
  console.log(`  Total Funding    ${usd(-totalFunding).padStart(12)}`);

  // Exit reason breakdown
  const reasons: Record<string, number> = {};
  for (const t of trades) { reasons[t.exitReason] = (reasons[t.exitReason] || 0) + 1; }
  console.log(`\n  Exit Reasons`);
  console.log(`  ${LINE}`);
  for (const [r, count] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r.padEnd(28)} ${String(count).padStart(6)}`);
  }

  // Comparison
  console.log(`\n  Comparison (${days} days, $${bankroll} bankroll)`);
  console.log(`  ${LINE}`);
  console.log(`  S6 BBWP Breakout: ${usd(netPnl).padStart(10)}  (${pct(netPnlPct)})`);
  console.log(`  S1+S2 portfolio:    +$81.00  (+16.2%)  [379-day ref]`);
  console.log(`  S3 Scalp:           -$82.00  (-16.4%)  [379-day ref]`);
  console.log(`  S4 Grid:             -$6.38   (-1.3%)  [379-day ref]`);

  // Recent trades
  const recent = trades.slice(-15);
  console.log(`\n  Recent Trades (last ${recent.length} of ${trades.length})`);
  console.log(`  ${LINE}`);
  console.log(`  ${"Entry".padEnd(16)} ${"Dir".padEnd(6)} ${"Lev".padStart(4)} ${"Entry$".padStart(8)} ${"Exit$".padStart(8)} ${"PnL".padStart(9)} ${"Hold".padStart(8)} ${"Reason"}`);
  console.log(`  ${LINE}`);
  for (const t of recent) {
    console.log(
      `  ${fmtDate(t.entryTimestamp).padEnd(16)} ${t.direction.padEnd(6)} ${(t.leverage + "x").padStart(4)} ${t.entryPrice.toFixed(0).padStart(8)} ${t.exitPrice.toFixed(0).padStart(8)} ${usd(t.pnlUsd).padStart(9)} ${fmtDuration(t.exitTimestamp - t.entryTimestamp).padStart(8)} ${t.exitReason}`,
    );
  }

  console.log(`\n${DLINE}\n`);

  // Save JSON
  const dir = path.join(process.cwd(), "backtest-results");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const now = new Date();
  const filename = `s6-${days}d-${now.toISOString().slice(0, 10).replace(/-/g, "")}.json`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify({
    strategy: "S6_BBWP_Breakout",
    config: { bankroll, marginPct, leverage, timeframe: tf, stopDistance: S6_STOP_DISTANCE },
    dateRange: { from: new Date(firstTs).toISOString().split("T")[0], to: new Date(lastTs).toISOString().split("T")[0], days },
    stats: { netPnl, netPnlPct, trades: trades.length, winRate, profitFactor: pf, maxDdUsd, maxDdPct, sharpe, totalFunding },
    trades: trades.map(t => ({ ...t, entryDate: new Date(t.entryTimestamp).toISOString(), exitDate: new Date(t.exitTimestamp).toISOString() })),
    equityCurve,
  }, null, 2));
  console.log(`[S6-Backtest] Results saved to: ${filePath}`);

  // Decision gate
  console.log("\n=== DECISION GATE ===");
  const viable = netPnl > 0 && trades.length >= 10;
  console.log(`  Trades: ${trades.length} | Net: ${usd(netPnl)} (${pct(netPnlPct)}) | PF: ${pf === Infinity ? "\u221E" : pf.toFixed(2)} | DD: ${usd(-maxDdUsd)}`);
  if (!viable) {
    if (trades.length < 10) console.log(`\n  RESULT: INSUFFICIENT DATA (<10 trades). Try --timeframe 1H for more signals.`);
    else console.log(`\n  RESULT: NEGATIVE EXPECTANCY.`);
  } else {
    console.log(`\n  RESULT: POSITIVE EXPECTANCY \u2014 S6 viable for integration.`);
  }
  console.log("");
}

// ── Trade builder ───────────────────────────────────────────────

function closeTrade(pos: Position, exitPrice: number, exitTs: number, reason: string): BacktestTrade {
  const dirMult = pos.direction === "long" ? 1 : -1;
  const pnlPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * dirMult;
  const grossPnl = pos.notionalUsd * pnlPct;
  const fees = pos.notionalUsd * TAKER_FEE * 2;
  const pnlUsd = grossPnl - fees - pos.accFunding;
  const dollarRisk = pos.notionalUsd * S6_STOP_DISTANCE;

  return {
    strategy: "S6" as any,
    activeStrategies: "S6",
    direction: pos.direction,
    entryTimestamp: pos.entryTimestamp,
    entryPrice: pos.entryPrice,
    exitTimestamp: exitTs,
    exitPrice,
    exitReason: reason,
    leverage: pos.leverage,
    marginUsd: pos.marginUsd,
    notionalUsd: pos.notionalUsd,
    pnlUsd,
    pnlPct: pnlPct * 100,
    pnlR: dollarRisk > 0 ? pnlUsd / dollarRisk : 0,
    stopPrice: pos.stopPrice,
    fundingPnl: pos.accFunding,
  };
}

main().catch(err => {
  console.error("[S6-Backtest] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
