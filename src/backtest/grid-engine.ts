/**
 * Grid backtest engine — simulates S4 grid strategy on historical data.
 *
 * Separate from the directional engine (engine.ts) because grids manage
 * N concurrent cells vs 1 position at a time.
 *
 * Uses the same data pipeline: Binance loader → aggregator → aligner.
 */

import { computeRegimeMap, type RegimeInfo } from "./regime-filter";
import type { AlignedBar, BarData } from "./types";
import {
  type GridConfig,
  type GridCell,
  type GridTrade,
  type GridStats,
  getVolTier,
  getSpacingForTier,
  buildGridLevels,
  buildCells,
  computeDailyVol,
} from "../strategy/s4_grid";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const MIN_NOTIONAL = 10;

// ── Public interface ────────────────────────────────────────────

export interface GridBacktestConfig {
  bankroll: number;
  grid: GridConfig;
}

export interface GridBacktestResult {
  config: GridBacktestConfig;
  trades: GridTrade[];
  stats: GridStats;
  equityCurve: Array<{ timestamp: number; equity: number }>;
  dateRange: { from: string; to: string; days: number };
}

export function runGridBacktest(
  aligned: AlignedBar[],
  dailyBars: BarData[],
  config: GridBacktestConfig,
): GridBacktestResult {
  const { bankroll, grid } = config;

  if (aligned.length === 0) throw new Error("No aligned bars");

  // Pre-compute regime map
  let regimeMap: Map<number, RegimeInfo> | null = null;
  if (grid.regimeFilter) {
    regimeMap = computeRegimeMap(dailyBars);
  }

  // ── Mutable state ───────────────────────────────────────────

  let equity = bankroll;
  let peakEquity = bankroll;
  let maxDdUsd = 0;
  let maxDdPct = 0;

  const trades: GridTrade[] = [];
  const equityCurve: Array<{ timestamp: number; equity: number }> = [];

  // Grid
  let currentMid = aligned[0].bar15m.close;
  let currentSpacing = grid.volatilityAdaptive
    ? grid.baseSpacingPct
    : grid.baseSpacingPct;
  let levels = buildGridLevels(currentMid, currentSpacing, grid.levelsPerSide);
  let cells = buildCells(levels);

  // Momentum detector
  const buyFillTimes: number[] = [];
  let momentumPaused = false;
  let momentumPauseCount = 0;

  // Regime
  let regimePaused = false;
  let regimePauseCount = 0;

  // Auto-recenter
  let barsOutsideGrid = 0;
  let recenterCountToday = 0;
  let currentDay = 0;
  let recenterTotal = 0;
  let dailyPaused = false;

  // Tracking
  let maxInventory = 0;
  let totalBars = 0;
  let pausedBars = 0;
  let totalLongFunding = 0;
  let totalRecenterLoss = 0;

  // Daily equity for Sharpe
  const dailyEquities: number[] = [bankroll];

  // Volatility
  let lastVolDay = 0;
  const dailyCloses: number[] = [];

  // Previous bar timestamp for funding delta
  let prevTs = aligned[0].bar15m.timestamp;

  // ── Main loop ─────────────────────────────────────────────────

  for (let i = 0; i < aligned.length; i++) {
    const bar = aligned[i].bar15m;
    const ts = bar.timestamp;
    const price = bar.close;
    const high = bar.high;
    const low = bar.low;
    totalBars++;

    // ── Day boundary ──────────────────────────────────────────
    const dayNum = Math.floor(ts / MS_PER_DAY);
    if (dayNum !== currentDay) {
      if (currentDay !== 0) dailyEquities.push(mtmEquity(cells, equity, price, grid));
      currentDay = dayNum;
      recenterCountToday = 0;
      dailyPaused = false;
    }

    // ── Volatility tier (re-evaluate on new daily bar) ────────
    if (grid.volatilityAdaptive) {
      const dBar = aligned[i].bar1D;
      if (dBar.timestamp !== lastVolDay) {
        lastVolDay = dBar.timestamp;
        dailyCloses.push(dBar.close);

        const vol = computeDailyVol(dailyCloses);
        const tier = getVolTier(vol);
        const newSpacing = getSpacingForTier(tier);

        if (newSpacing !== currentSpacing) {
          const closed = closeAllCells(cells, price, ts, grid, "vol_recenter");
          for (const t of closed) {
            if (t.netPnl < 0) totalRecenterLoss += Math.abs(t.netPnl);
            equity += t.netPnl;
            trades.push(t);
          }
          currentSpacing = newSpacing;
          currentMid = price;
          levels = buildGridLevels(currentMid, currentSpacing, grid.levelsPerSide);
          cells = buildCells(levels);
        }
      }
    }

    // ── Regime filter ─────────────────────────────────────────
    if (regimeMap) {
      const regime = regimeMap.get(aligned[i].bar1D.timestamp);
      const was = regimePaused;
      regimePaused = regime?.trending ?? false;
      if (regimePaused && !was) regimePauseCount++;
    }

    // ── Momentum detector ─────────────────────────────────────
    const windowStart = ts - grid.momentumWindowMs;
    while (buyFillTimes.length > 0 && buyFillTimes[0] < windowStart) {
      buyFillTimes.shift();
    }
    const wasMom = momentumPaused;
    momentumPaused = buyFillTimes.length >= grid.momentumThreshold;
    if (momentumPaused && !wasMom) momentumPauseCount++;

    const sellOnly = regimePaused || momentumPaused || dailyPaused;
    if (sellOnly) pausedBars++;

    // ── Apply funding (time since prev bar) ───────────────────
    const hours = (ts - prevTs) / MS_PER_HOUR;
    if (hours > 0) {
      for (const cell of cells) {
        if (!cell.filled) continue;
        const cost = cell.sizeBase * cell.entryPrice * grid.hourlyFundingRate * hours;
        cell.accFunding += cost;
        totalLongFunding += cost;
      }
    }
    prevTs = ts;

    // ── SELLS: close filled cells at topPrice ─────────────────
    for (const cell of cells) {
      if (!cell.filled) continue;
      if (high >= cell.topPrice) {
        const t = buildTrade(cell, cell.topPrice, ts, grid, "round_trip");
        trades.push(t);
        equity += t.netPnl;
        resetCell(cell);
      }
    }

    // ── BUYS: fill empty cells at bottomPrice ─────────────────
    if (!sellOnly) {
      for (const cell of cells) {
        if (cell.filled) continue;
        if (low <= cell.bottomPrice) {
          const margin = equity * grid.marginPctPerLevel;
          const notional = margin * grid.leverage;
          if (notional < MIN_NOTIONAL) continue;

          cell.filled = true;
          cell.entryPrice = cell.bottomPrice;
          cell.entryTime = ts;
          cell.sizeBase = notional / cell.bottomPrice;
          cell.marginUsed = margin;
          cell.accFunding = 0;

          buyFillTimes.push(ts);
        }
      }
    }

    // ── Inventory tracking ────────────────────────────────────
    const inv = cells.filter(c => c.filled).length;
    if (inv > maxInventory) maxInventory = inv;

    // ── Auto-recenter ─────────────────────────────────────────
    const gridLow = levels[0];
    const gridHigh = levels[levels.length - 1];
    if (price < gridLow || price > gridHigh) {
      barsOutsideGrid++;
      if (barsOutsideGrid >= grid.recenterBarsThreshold) {
        if (recenterCountToday < grid.recenterDailyCap) {
          const closed = closeAllCells(cells, price, ts, grid, "recenter_close");
          for (const t of closed) {
            if (t.netPnl < 0) totalRecenterLoss += Math.abs(t.netPnl);
            equity += t.netPnl;
            trades.push(t);
          }
          currentMid = price;
          levels = buildGridLevels(currentMid, currentSpacing, grid.levelsPerSide);
          cells = buildCells(levels);
          recenterCountToday++;
          recenterTotal++;
          barsOutsideGrid = 0;
        } else {
          dailyPaused = true;
        }
      }
    } else {
      barsOutsideGrid = 0;
    }

    // ── Drawdown (mark-to-market) ─────────────────────────────
    const mtm = mtmEquity(cells, equity, price, grid);
    if (mtm > peakEquity) peakEquity = mtm;
    const dd = peakEquity - mtm;
    if (dd > maxDdUsd) {
      maxDdUsd = dd;
      maxDdPct = peakEquity > 0 ? dd / peakEquity : 0;
    }

    // Equity curve every 4h (16 bars)
    if (totalBars % 16 === 0) {
      equityCurve.push({ timestamp: ts, equity: mtm });
    }
  }

  // ── Close remaining positions at end of data ────────────────

  const lastBar = aligned[aligned.length - 1].bar15m;
  const endTrades = closeAllCells(cells, lastBar.close, lastBar.timestamp, grid, "end_of_data");
  for (const t of endTrades) {
    equity += t.netPnl;
    trades.push(t);
  }
  dailyEquities.push(equity);

  // ── Compute stats ─────────────────────────────────────────────

  const roundTrips = trades.filter(t => t.exitReason === "round_trip");
  const winners = trades.filter(t => t.netPnl > 0);
  const losers = trades.filter(t => t.netPnl <= 0);

  const grossWin = winners.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losers.reduce((s, t) => s + t.netPnl, 0));

  const stats: GridStats = {
    totalRoundTrips: roundTrips.length,
    avgRoundTripTimeMs: roundTrips.length > 0
      ? roundTrips.reduce((s, t) => s + (t.exitTime - t.entryTime), 0) / roundTrips.length
      : 0,
    grossRoundTripPnl: roundTrips.reduce((s, t) => s + t.grossPnl, 0),
    totalFees: trades.reduce((s, t) => s + t.fees, 0),
    longFundingPaid: totalLongFunding,
    shortFundingPaid: 0,
    recenterLosses: totalRecenterLoss,
    recenterCount: recenterTotal,
    netPnl: equity - bankroll,
    netPnlPct: ((equity - bankroll) / bankroll) * 100,
    maxInventory,
    maxDrawdownUsd: maxDdUsd,
    maxDrawdownPct: maxDdPct * 100,
    momentumPauses: momentumPauseCount,
    regimePauses: regimePauseCount,
    sharpeRatio: computeSharpe(dailyEquities),
    winRate: trades.length > 0 ? winners.length / trades.length : 0,
    winners: winners.length,
    losers: losers.length,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgWin: winners.length > 0 ? grossWin / winners.length : 0,
    avgLoss: losers.length > 0 ? grossLoss / losers.length : 0,
    totalBars,
    pausedBars,
    gridUptimePct: totalBars > 0 ? ((totalBars - pausedBars) / totalBars) * 100 : 0,
  };

  const firstTs = aligned[0].bar15m.timestamp;
  const lastTs = aligned[aligned.length - 1].bar15m.timestamp;

  return {
    config,
    trades,
    stats,
    equityCurve,
    dateRange: {
      from: new Date(firstTs).toISOString().split("T")[0],
      to: new Date(lastTs).toISOString().split("T")[0],
      days: Math.round((lastTs - firstTs) / MS_PER_DAY),
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────

function buildTrade(
  cell: GridCell,
  exitPrice: number,
  exitTime: number,
  config: GridConfig,
  reason: GridTrade["exitReason"],
): GridTrade {
  const grossPnl = cell.sizeBase * (exitPrice - cell.entryPrice);
  const entryFee = cell.sizeBase * cell.entryPrice * config.feePct;
  const exitFee = cell.sizeBase * exitPrice * config.feePct;
  return {
    entryPrice: cell.entryPrice,
    exitPrice,
    entryTime: cell.entryTime,
    exitTime,
    sizeBase: cell.sizeBase,
    marginUsed: cell.marginUsed,
    leverage: config.leverage,
    grossPnl,
    fees: entryFee + exitFee,
    funding: cell.accFunding,
    netPnl: grossPnl - (entryFee + exitFee) - cell.accFunding,
    exitReason: reason,
  };
}

function closeAllCells(
  cells: GridCell[],
  marketPrice: number,
  timestamp: number,
  config: GridConfig,
  reason: GridTrade["exitReason"],
): GridTrade[] {
  const result: GridTrade[] = [];
  for (const cell of cells) {
    if (!cell.filled) continue;
    result.push(buildTrade(cell, marketPrice, timestamp, config, reason));
    resetCell(cell);
  }
  return result;
}

function resetCell(cell: GridCell): void {
  cell.filled = false;
  cell.entryPrice = 0;
  cell.entryTime = 0;
  cell.sizeBase = 0;
  cell.marginUsed = 0;
  cell.accFunding = 0;
}

function mtmEquity(
  cells: GridCell[],
  realizedEquity: number,
  currentPrice: number,
  config: GridConfig,
): number {
  let unrealized = 0;
  for (const cell of cells) {
    if (!cell.filled) continue;
    const gross = cell.sizeBase * (currentPrice - cell.entryPrice);
    const entryFee = cell.sizeBase * cell.entryPrice * config.feePct;
    const exitFee = cell.sizeBase * currentPrice * config.feePct;
    unrealized += gross - entryFee - exitFee - cell.accFunding;
  }
  return realizedEquity + unrealized;
}

function computeSharpe(dailyEquities: number[]): number | null {
  if (dailyEquities.length < 10) return null;
  const returns: number[] = [];
  for (let i = 1; i < dailyEquities.length; i++) {
    if (dailyEquities[i - 1] > 0) {
      returns.push((dailyEquities[i] - dailyEquities[i - 1]) / dailyEquities[i - 1]);
    }
  }
  if (returns.length < 10) return null;
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - avg) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  return stdDev > 0 ? (avg / stdDev) * Math.sqrt(252) : null;
}
