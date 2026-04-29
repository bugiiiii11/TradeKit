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
import { sendDiscord, Colors } from "../notifications/discord";

const S3_STOP_DISTANCE = 0.004; // 0.4% — midpoint of 0.3–0.5% range

/** Minimum hold time before allowing stoch_rsi_reverse_cross exit.
 *  Backtest analysis (90d, 102 S3 trades): all reverse-cross exits at
 *  ≤45min were losses (15 trades, -$3.75). Blocking early noise exits
 *  lets winners ride to TP/max_hold instead of chopping out. */
export const S3_MIN_HOLD_MS = 45 * 60 * 1000; // 45 minutes (3 bars)

/** 1H BBWP must be below this threshold for S3 entry.
 *  Low BBWP = narrow Bollinger Bands = low-volatility regime where
 *  StochRSI overbought/oversold extremes actually mean-revert.
 *  High BBWP = wide bands = trending/volatile → StochRSI crosses are noise. */
export const S3_BBWP_MAX = 40;

/** Configurable thresholds for backtesting — modify before runBacktest() */
export const S3_CONFIG = {
  obThreshold: 80,
  osThreshold: 20,
};

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

  const { stochK, stochD, rsi14, close } = snap15m;
  const prevK = prev15m.stochK;
  const prevD = prev15m.stochD;

  const bullishCross = prevK <= prevD && stochK > stochD;
  const bearishCross = prevK >= prevD && stochK < stochD;

  if (!bullishCross && !bearishCross) return null;

  const crossDir = bullishCross ? "bull" : "bear";
  const bbwpOk = snap1H.bbwp < S3_BBWP_MAX;
  const oversold = stochK < S3_CONFIG.osThreshold && stochD < S3_CONFIG.osThreshold;
  const overbought = stochK > S3_CONFIG.obThreshold && stochD > S3_CONFIG.obThreshold;
  const nearEma21Long = isNearOrAboveEMA21(close, snap1H.ema21);
  const nearEma21Short = isNearOrBelowEMA21(close, snap1H.ema21);
  const rsiLong = rsi14 >= 30 && rsi14 <= 50;
  const rsiShort = rsi14 >= 50 && rsi14 <= 70;

  const diagMsg =
    `Cross=${crossDir} K=${stochK.toFixed(1)} D=${stochD.toFixed(1)} ` +
    `RSI=${rsi14.toFixed(1)} BBWP=${snap1H.bbwp.toFixed(1)}(${bbwpOk ? "ok" : "FAIL"}) ` +
    `OB=${overbought} OS=${oversold} ` +
    `EMA21=${nearEma21Long ? "ok" : "FAIL"}/${nearEma21Short ? "ok" : "FAIL"} ` +
    `RSI-L=${rsiLong} RSI-S=${rsiShort}`;
  console.log(`[S3-diag] ${diagMsg}`);
  sendDiscord("signals", `S3 StochRSI Cross\n${diagMsg}`, Colors.gold);

  if (!bbwpOk) return null;

  if (
    bullishCross &&
    oversold &&
    nearEma21Long &&
    rsiLong
  ) {
    return { direction: "long", strategy: "S3", stopDistancePct: S3_STOP_DISTANCE };
  }

  if (
    bearishCross &&
    overbought &&
    nearEma21Short &&
    rsiShort
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

  // Reverse Stoch RSI cross — only after minimum hold time
  const entryMs = new Date(entryTimestamp).getTime();
  const nowMs = Date.now();
  const holdMs = nowMs - entryMs;

  const reverseBearish = prevK >= prevD && stochK < stochD && positionDirection === "long";
  const reverseBullish = prevK <= prevD && stochK > stochD && positionDirection === "short";

  if ((reverseBearish || reverseBullish) && holdMs >= S3_MIN_HOLD_MS) {
    return { exit: true, reason: "stoch_rsi_reverse_cross" };
  }

  // Note: take-profit is handled by native Hyperliquid TP orders (1%/3%/5%),
  // placed at entry time by main.ts. No soft TP check needed here.

  // 2-hour max hold
  if (holdMs >= 2 * 60 * 60 * 1000) {
    return { exit: true, reason: "max_hold_time" };
  }

  return { exit: false, reason: "" };
}
