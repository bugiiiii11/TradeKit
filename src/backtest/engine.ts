/**
 * Backtesting engine — strategy replay loop.
 *
 * Iterates through AlignedBar[] chronologically, calling the same
 * evaluateS1/S2/S3 functions the live bot uses for entry detection.
 * Exit logic is re-implemented inline to avoid module-level state
 * ordering issues (the strategy modules update their prev-snapshot
 * state inside evaluate(), which would corrupt shouldExitS*() if
 * called after evaluate() on the same bar).
 *
 * Key simplifications (v1):
 *   - One open position at a time (no concurrent positions)
 *   - SL/TP hit detection uses bar high/low (not tick data)
 *   - S3 TPs: full position exits at the highest TP level reached
 *     in the bar (simplified vs the real 33/33/34% partial closes)
 *   - Macro filter applied via scoreSignals (matches live bot)
 *   - Taker fee 0.045% per side (0.09% round-trip) deducted from PnL
 *   - Funding rate applied hourly to open positions
 */

import { evaluateS1, resetS1State } from "../strategy/s1_ema_trend";
import { evaluateS2, resetS2State } from "../strategy/s2_mean_reversion";
import { evaluateS3, resetS3State, S3_MIN_HOLD_MS } from "../strategy/s3_stoch_rsi";
import { scoreSignals, getLeverageForSignals } from "../strategy/confluence";
import type { IndicatorSnapshot, Timeframe } from "../tradingview/reader";
import { computeRegimeMap, type RegimeInfo } from "./regime-filter";
import type {
  AlignedBar,
  BarData,
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  Direction,
  FilteredSignal,
  OpenPosition,
  StrategyId,
} from "./types";

const TAKER_FEE = 0.00045; // 0.045% per side → 0.09% round-trip (Tier 0)
const SLIPPAGE_BPS = 0;    // additional cost per side in basis points (0 = disabled)

// Funding rate: +0.01% per 8h = 0.00125% per hour (conservative bull-market estimate)
const DEFAULT_HOURLY_FUNDING_RATE = 0.0000125; // 0.00125%
const MS_PER_HOUR = 3_600_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function barToSnapshot(bar: BarData, timeframe: Timeframe): IndicatorSnapshot {
  return {
    timeframe,
    close:  bar.close,
    ema8:   bar.ema8,
    ema13:  bar.ema13,
    ema21:  bar.ema21,
    ema55:  bar.ema55,
    ema200: bar.ema200,
    rsi14:  bar.rsi14,
    stochK: bar.stochK,
    stochD: bar.stochD,
    bbwp:   bar.bbwp,
    pmarp:  bar.pmarp,
    timestamp: new Date(bar.timestamp).toISOString(),
  };
}

function s3TpPrices(
  entryPrice: number,
  direction: Direction,
): [number, number, number] {
  const mult = direction === "long" ? 1 : -1;
  return [
    entryPrice * (1 + mult * 0.01),
    entryPrice * (1 + mult * 0.03),
    entryPrice * (1 + mult * 0.05),
  ];
}

// ---------------------------------------------------------------------------
// Exit detection — uses engine-tracked prev bars (not module state)
// ---------------------------------------------------------------------------

interface ExitResult {
  exit:      boolean;
  exitPrice: number;
  reason:    string;
}

function checkExit(
  pos:        OpenPosition,
  prev15m:    BarData | null,
  prev4H:     BarData | null,
  prev1H:     BarData | null,
  bar15m:     BarData,
  bar4H:      BarData,
  bar1H:      BarData,
): ExitResult {
  const { direction, stopPrice, strategy, tpPrices, entryTimestamp } = pos;
  const noExit: ExitResult = { exit: false, exitPrice: 0, reason: "" };

  // --- SL (intra-bar, using high/low) ---
  if (direction === "long"  && bar15m.low  <= stopPrice) return { exit: true, exitPrice: stopPrice, reason: "stop_loss" };
  if (direction === "short" && bar15m.high >= stopPrice) return { exit: true, exitPrice: stopPrice, reason: "stop_loss" };

  // --- S3 TP (check highest reached, exit full position there) ---
  if (strategy === "S3" && tpPrices) {
    if (direction === "long") {
      if (bar15m.high >= tpPrices[2]) return { exit: true, exitPrice: tpPrices[2], reason: "tp3" };
      if (bar15m.high >= tpPrices[1]) return { exit: true, exitPrice: tpPrices[1], reason: "tp2" };
      if (bar15m.high >= tpPrices[0]) return { exit: true, exitPrice: tpPrices[0], reason: "tp1" };
    } else {
      if (bar15m.low <= tpPrices[2]) return { exit: true, exitPrice: tpPrices[2], reason: "tp3" };
      if (bar15m.low <= tpPrices[1]) return { exit: true, exitPrice: tpPrices[1], reason: "tp2" };
      if (bar15m.low <= tpPrices[0]) return { exit: true, exitPrice: tpPrices[0], reason: "tp1" };
    }
  }

  // --- S1: EMA8/EMA55 reverse cross on 4H ---
  if (strategy === "S1" && prev4H) {
    const wasAbove = prev4H.ema8 > prev4H.ema55;
    const isAbove  = bar4H.ema8  > bar4H.ema55;
    if (direction === "long"  && wasAbove && !isAbove) return { exit: true, exitPrice: bar15m.close, reason: "s1_ema_cross" };
    if (direction === "short" && !wasAbove && isAbove) return { exit: true, exitPrice: bar15m.close, reason: "s1_ema_cross" };
  }

  // --- S2: PMARP reversal, BBWP expansion, 4H trend flip, 1H EMA cross ---
  if (strategy === "S2" && prev1H) {
    const pmarpReversal  = prev1H.pmarp >= 85 && bar1H.pmarp < 85;
    const bbwpExpansion  = bar1H.bbwp >= 85;
    const trend4HFlipped =
      direction === "long"
        ? bar4H.ema21 < bar4H.ema55
        : bar4H.ema21 > bar4H.ema55;
    const ema1HFlipped   =
      direction === "long"
        ? bar1H.ema21 < bar1H.ema55
        : bar1H.ema21 > bar1H.ema55;
    if (pmarpReversal || bbwpExpansion || trend4HFlipped || ema1HFlipped) {
      return { exit: true, exitPrice: bar15m.close, reason: "s2_indicator_exit" };
    }
  }

  // --- S3: reverse StochRSI cross (only after min hold time) ---
  if (strategy === "S3" && prev15m) {
    const holdMs = bar15m.timestamp - entryTimestamp;
    const reverseBearish =
      prev15m.stochK >= prev15m.stochD &&
      bar15m.stochK   <  bar15m.stochD  &&
      direction === "long";
    const reverseBullish =
      prev15m.stochK <= prev15m.stochD &&
      bar15m.stochK   >  bar15m.stochD  &&
      direction === "short";
    if ((reverseBearish || reverseBullish) && holdMs >= S3_MIN_HOLD_MS) {
      return { exit: true, exitPrice: bar15m.close, reason: "stoch_rsi_reverse_cross" };
    }
    // 2-hour max hold
    if (holdMs >= 2 * 60 * 60 * 1000) {
      return { exit: true, exitPrice: bar15m.close, reason: "max_hold_time" };
    }
  }

  return noExit;
}

// ---------------------------------------------------------------------------
// Trade builder
// ---------------------------------------------------------------------------

function buildTrade(
  pos:              OpenPosition,
  activeStrategies: string,
  exitPrice:        number,
  exitTimestamp:    number,
  reason:           string,
  accumulatedFunding: number,
): BacktestTrade {
  const dirMult = pos.direction === "long" ? 1 : -1;
  const pnlPct  = ((exitPrice - pos.entryPrice) / pos.entryPrice) * dirMult;
  const grossPnl = pos.notionalUsd * pnlPct;
  const feesUsd  = pos.notionalUsd * (TAKER_FEE + SLIPPAGE_BPS / 10_000) * 2;
  const pnlUsd   = grossPnl - feesUsd - accumulatedFunding;
  const dollarRisk = pos.notionalUsd * pos.stopDistancePct;
  const pnlR     = dollarRisk > 0 ? pnlUsd / dollarRisk : 0;

  return {
    strategy:         pos.strategy,
    activeStrategies,
    direction:        pos.direction,
    entryTimestamp:   pos.entryTimestamp,
    entryPrice:       pos.entryPrice,
    exitTimestamp,
    exitPrice,
    exitReason:       reason,
    leverage:         pos.leverage,
    marginUsd:        pos.marginUsd,
    notionalUsd:      pos.notionalUsd,
    pnlUsd,
    pnlPct:           pnlPct * 100,
    pnlR,
    stopPrice:        pos.stopPrice,
    fundingPnl:       accumulatedFunding,
  };
}

// ---------------------------------------------------------------------------
// Main backtest loop
// ---------------------------------------------------------------------------

export function runBacktest(
  alignedBars: AlignedBar[],
  config:      BacktestConfig,
): BacktestResult {
  if (alignedBars.length === 0) {
    throw new Error("No aligned bars to backtest — check data collection.");
  }

  // Reset all strategy module state
  resetS1State();
  resetS2State();
  resetS3State();

  const trades: BacktestTrade[] = [];
  const filteredSignals: FilteredSignal[] = [];
  let equity = config.bankroll;
  const equityCurve: Array<{ timestamp: number; equity: number }> = [
    { timestamp: alignedBars[0].bar15m.timestamp, equity },
  ];

  let openPos: OpenPosition | null = null;
  let activeStrategies = "";
  let accumulatedFunding = 0;
  let lastFundingHour = -1;

  // Regime filter: extract unique daily bars and pre-compute regime map
  let regimeMap: Map<number, RegimeInfo> | null = null;
  if (config.regimeFilter) {
    const seenDaily = new Set<number>();
    const uniqueDailyBars: BarData[] = [];
    for (const ab of alignedBars) {
      if (!seenDaily.has(ab.bar1D.timestamp)) {
        seenDaily.add(ab.bar1D.timestamp);
        uniqueDailyBars.push(ab.bar1D);
      }
    }
    regimeMap = computeRegimeMap(uniqueDailyBars);
  }

  // Engine-tracked prev bars (for exit cross detection)
  let prev15m: BarData | null = null;
  let prev4H:  BarData | null = null;
  let prev1H:  BarData | null = null;

  for (const aligned of alignedBars) {
    const { bar15m, bar1H, bar4H, bar1D } = aligned;

    const snap15m = barToSnapshot(bar15m, "15m");
    const snap1H  = barToSnapshot(bar1H,  "1H");
    const snap4H  = barToSnapshot(bar4H,  "4H");
    const snap1D  = barToSnapshot(bar1D,  "1D");

    // === FUNDING RATE APPLICATION (hourly) ===
    if (openPos) {
      const currentHour = Math.floor(bar15m.timestamp / MS_PER_HOUR);
      if (currentHour !== lastFundingHour) {
        // Longs pay positive funding, shorts receive it
        const dirMult = openPos.direction === "long" ? 1 : -1;
        accumulatedFunding += openPos.notionalUsd * DEFAULT_HOURLY_FUNDING_RATE * dirMult;
        lastFundingHour = currentHour;
      }
    }

    // === PHASE 1: EXIT CHECKS (before evaluate() updates module prev state) ===
    if (openPos) {
      const exitResult = checkExit(openPos, prev15m, prev4H, prev1H, bar15m, bar4H, bar1H);
      if (exitResult.exit) {
        const trade = buildTrade(openPos, activeStrategies, exitResult.exitPrice, bar15m.timestamp, exitResult.reason, accumulatedFunding);
        trades.push(trade);
        equity += trade.pnlUsd;
        equityCurve.push({ timestamp: bar15m.timestamp, equity });
        openPos = null;
        activeStrategies = "";
        accumulatedFunding = 0;
        lastFundingHour = -1;
      }
    }

    // === PHASE 2: ENTRY EVALUATION (updates module prev state) ===
    const enabled = config.enabledStrategies ?? ["S1", "S2", "S3"];
    const s1Signal = evaluateS1(snap4H, snap1D);
    const s2Signal = evaluateS2(snap1H, snap4H);
    const s3Signal = evaluateS3(snap15m, snap1H);

    if (!openPos) {
      const rawSignals = [s1Signal, s2Signal, s3Signal].filter(
        (s): s is NonNullable<typeof s> => s !== null && enabled.includes(s.strategy as StrategyId),
      );

      if (rawSignals.length > 0) {
        // Apply macro filter + confluence scoring (matches live bot behaviour)
        const confluence = scoreSignals(rawSignals, snap1D);

        if (confluence.score > 0 && confluence.direction !== null) {
          const dir       = confluence.direction;
          const leverage  = getLeverageForSignals(rawSignals);

          // Pick primary strategy for labelling (S1 > S2 > S3)
          const primary = rawSignals.find(s => s.strategy === "S1")
            ?? rawSignals.find(s => s.strategy === "S2")
            ?? rawSignals[0];

          // Regime filter: block S3 entries in trending markets
          if (regimeMap && primary.strategy === "S3") {
            const regime = regimeMap.get(bar1D.timestamp);
            if (regime?.trending) {
              filteredSignals.push({
                timestamp: bar15m.timestamp,
                strategy: "S3",
                direction: dir,
                regime: regime.regime,
                price: bar15m.close,
              });
              // Skip to next bar — don't open position
              prev15m = bar15m;
              prev4H = bar4H;
              prev1H = bar1H;
              continue;
            }
          }

          const stopDistPct = primary.stopDistancePct;
          const marginUsd   = equity * config.marginPct;
          const notionalUsd = marginUsd * leverage;
          const entryPrice  = bar15m.close;
          const stopPrice   =
            dir === "long"
              ? entryPrice * (1 - stopDistPct)
              : entryPrice * (1 + stopDistPct);

          const tpPrices: [number, number, number] | undefined =
            primary.strategy === "S3"
              ? s3TpPrices(entryPrice, dir)
              : undefined;

          openPos = {
            strategy:       primary.strategy as StrategyId,
            direction:      dir,
            entryPrice,
            entryTimestamp: bar15m.timestamp,
            leverage,
            marginUsd,
            notionalUsd,
            stopPrice,
            stopDistancePct: stopDistPct,
            tpPrices,
          };
          activeStrategies = rawSignals.map(s => s.strategy).sort().join(",");
        }
      }
    }

    // Update engine prev bars at end of bar
    prev15m = bar15m;
    prev4H  = bar4H;
    prev1H  = bar1H;
  }

  // Close any position still open at the end of the backtest window
  if (openPos && alignedBars.length > 0) {
    const lastBar = alignedBars[alignedBars.length - 1].bar15m;
    const trade = buildTrade(openPos, activeStrategies, lastBar.close, lastBar.timestamp, "backtest_end", accumulatedFunding);
    trades.push(trade);
    equity += trade.pnlUsd;
    equityCurve.push({ timestamp: lastBar.timestamp, equity });
  }

  return {
    config,
    trades,
    equityCurve,
    stats: computeStats(trades, config.bankroll, equityCurve),
    filteredSignals: config.regimeFilter ? filteredSignals : undefined,
  };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function computeStats(
  trades:     BacktestTrade[],
  startEquity: number,
  equityCurve: Array<{ timestamp: number; equity: number }>,
): BacktestResult["stats"] {
  const empty = {
    trades: 0, winRate: 0, pnlUsd: 0,
  };
  const byStrategy: BacktestResult["stats"]["byStrategy"] = {
    S1: { ...empty },
    S2: { ...empty },
    S3: { ...empty },
  };

  if (trades.length === 0) {
    return {
      totalTrades: 0, winners: 0, losers: 0, winRate: 0,
      totalPnlUsd: 0, grossWin: 0, grossLoss: 0, profitFactor: 0,
      maxDrawdownUsd: 0, maxDrawdownPct: 0,
      avgWinUsd: 0, avgLossUsd: 0, avgRMultiple: 0,
      sharpeRatio: null, byStrategy,
    };
  }

  const winners = trades.filter(t => t.pnlUsd > 0);
  const losers  = trades.filter(t => t.pnlUsd <= 0);
  const grossWin  = winners.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnlUsd, 0));
  const totalPnl  = trades.reduce((s, t) => s + t.pnlUsd, 0);

  // Per-strategy stats
  for (const id of ["S1", "S2", "S3"] as StrategyId[]) {
    const st = trades.filter(t => t.strategy === id);
    if (st.length === 0) continue;
    const w = st.filter(t => t.pnlUsd > 0).length;
    byStrategy[id] = {
      trades:  st.length,
      winRate: w / st.length,
      pnlUsd:  st.reduce((s, t) => s + t.pnlUsd, 0),
    };
  }

  // Max drawdown from equity curve
  let peakEquity = startEquity;
  let maxDD = 0;
  for (const point of equityCurve) {
    if (point.equity > peakEquity) peakEquity = point.equity;
    const dd = peakEquity - point.equity;
    if (dd > maxDD) maxDD = dd;
  }

  // Annualised Sharpe from equity curve daily returns
  let sharpeRatio: number | null = null;
  if (equityCurve.length >= 10) {
    const dailyMap = new Map<string, number>();
    for (const pt of equityCurve) {
      const day = new Date(pt.timestamp).toISOString().slice(0, 10);
      dailyMap.set(day, pt.equity); // last equity of the day wins
    }
    const days = [...dailyMap.values()];
    if (days.length >= 2) {
      const returns: number[] = [];
      for (let i = 1; i < days.length; i++) {
        returns.push((days[i] - days[i - 1]) / days[i - 1]);
      }
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
      const std = Math.sqrt(variance);
      sharpeRatio = std > 0 ? (mean / std) * Math.sqrt(252) : null;
    }
  }

  return {
    totalTrades: trades.length,
    winners: winners.length,
    losers:  losers.length,
    winRate: winners.length / trades.length,
    totalPnlUsd: totalPnl,
    grossWin,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownUsd: maxDD,
    maxDrawdownPct: startEquity > 0 ? (maxDD / startEquity) * 100 : 0,
    avgWinUsd:  winners.length > 0 ? grossWin  / winners.length : 0,
    avgLossUsd: losers.length  > 0 ? grossLoss / losers.length  : 0,
    avgRMultiple: trades.reduce((s, t) => s + t.pnlR, 0) / trades.length,
    sharpeRatio,
    byStrategy,
  };
}
