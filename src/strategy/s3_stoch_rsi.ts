/**
 * Strategy 3: Stochastic RSI Momentum Scalp
 *
 * Timeframes: 15m (entry signal), 1H (trend filter)
 * Style: Scalping — quick momentum reversals at overbought/oversold extremes
 * Default leverage: 3x
 * Max hold: 2 hours
 *
 * Long: StochRSI %K crosses above %D, both < 20, price near/above EMA21 (1H), RSI 30–50
 * Short: StochRSI %K crosses below %D, both > 80, price near/below EMA21 (1H), RSI 50–70
 *
 * Exit: opposite Stoch RSI cross, 0.5–1.5% profit target, 0.3–0.5% stop, 2h max hold
 */

import { IndicatorSnapshot } from "../tradingview/reader";
import { Signal } from "./types";

const S3_STOP_DISTANCE = 0.004; // 0.4% — midpoint of 0.3–0.5% range

/** Price must be within this % of EMA21 to qualify as "near" it */
const EMA21_PROXIMITY_THRESHOLD = 0.005; // 0.5%

/** Previous 15m snapshot for cross detection */
let prev15m: IndicatorSnapshot | null = null;

export function evaluateS3(
  snap15m: IndicatorSnapshot,
  snap1H: IndicatorSnapshot
): Signal | null {
  const signal = checkStochCross(snap15m, snap1H);
  prev15m = snap15m;
  return signal;
}

export function resetS3State(): void {
  prev15m = null;
}

// ---------------------------------------------------------------------------

function checkStochCross(
  snap15m: IndicatorSnapshot,
  snap1H: IndicatorSnapshot
): Signal | null {
  if (!prev15m) return null;

  const { stochK, stochD, rsi14, close, ema21 } = snap15m;
  const prevK = prev15m.stochK;
  const prevD = prev15m.stochD;

  // Detect %K/%D crossover
  const bullishCross = prevK <= prevD && stochK > stochD;
  const bearishCross = prevK >= prevD && stochK < stochD;

  // Long: %K crosses above %D from below 20 (oversold recovery)
  if (
    bullishCross &&
    stochK < 20 &&
    stochD < 20 &&
    isNearOrAboveEMA21(close, snap1H.ema21) &&
    rsi14 >= 30 &&
    rsi14 <= 50
  ) {
    return { direction: "long", strategy: "S3", stopDistancePct: S3_STOP_DISTANCE };
  }

  // Short: %K crosses below %D from above 80 (overbought reversal)
  if (
    bearishCross &&
    stochK > 80 &&
    stochD > 80 &&
    isNearOrBelowEMA21(close, snap1H.ema21) &&
    rsi14 >= 50 &&
    rsi14 <= 70
  ) {
    return { direction: "short", strategy: "S3", stopDistancePct: S3_STOP_DISTANCE };
  }

  return null;
}

function isNearOrAboveEMA21(close: number, ema21: number): boolean {
  // Price is above EMA21, or within proximity threshold below it
  const distancePct = (close - ema21) / ema21;
  return distancePct >= -EMA21_PROXIMITY_THRESHOLD;
}

function isNearOrBelowEMA21(close: number, ema21: number): boolean {
  // Price is below EMA21, or within proximity threshold above it
  const distancePct = (ema21 - close) / ema21;
  return distancePct >= -EMA21_PROXIMITY_THRESHOLD;
}

// ---------------------------------------------------------------------------

/**
 * S3 exit check — call on every 15m candle close while in a S3 position.
 * Returns true if the position should be closed.
 */
export function shouldExitS3(
  snap15m: IndicatorSnapshot,
  positionDirection: "long" | "short",
  entryPrice: number,
  entryTimestamp: string
): { exit: boolean; reason: string } {
  const { stochK, stochD, close } = snap15m;

  if (!prev15m) return { exit: false, reason: "" };

  const prevK = prev15m.stochK;
  const prevD = prev15m.stochD;

  // Reverse Stoch RSI cross
  const reverseBearish = prevK >= prevD && stochK < stochD && positionDirection === "long";
  const reverseBullish = prevK <= prevD && stochK > stochD && positionDirection === "short";

  if (reverseBearish || reverseBullish) {
    return { exit: true, reason: "stoch_rsi_reverse_cross" };
  }

  // Profit target: 0.5–1.5% (use 1% as default take-profit)
  const priceMoveTarget = 0.01;
  if (positionDirection === "long" && close >= entryPrice * (1 + priceMoveTarget)) {
    return { exit: true, reason: "profit_target" };
  }
  if (positionDirection === "short" && close <= entryPrice * (1 - priceMoveTarget)) {
    return { exit: true, reason: "profit_target" };
  }

  // 2-hour max hold
  const entryMs = new Date(entryTimestamp).getTime();
  const nowMs = Date.now();
  const holdMs = nowMs - entryMs;
  if (holdMs >= 2 * 60 * 60 * 1000) {
    return { exit: true, reason: "max_hold_time" };
  }

  return { exit: false, reason: "" };
}
