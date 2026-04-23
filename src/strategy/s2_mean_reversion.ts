/**
 * Strategy 2: RSI + EMA Mean Reversion
 *
 * Timeframes: 1H (entry trigger), 4H (trend context)
 * Style: Swing/day trading — bounces off EMA55 during low-volatility consolidation
 * Default leverage: 3x–5x
 *
 * Long: EMA21 > EMA55 (bullish trend), BBWP < 35, PMARP < 50,
 *        price retests EMA55 from above, RSI 35–55
 * Short: EMA21 < EMA55 (bearish trend), BBWP < 35, PMARP > 50,
 *         price retests EMA55 from below, RSI 45–65
 *
 * Exit: PMARP closes above 85 then back below, BBWP > 85, EMA21/EMA55 cross,
 *       or stop-loss (below/above recent swing low/high, ~1–2%)
 */

import { IndicatorSnapshot } from "../tradingview/reader";
import { Signal } from "./types";

const S2_STOP_DISTANCE = 0.015; // 1.5% — midpoint of 1–2% range

/**
 * Price must be within this % of EMA55 to qualify as a "retest".
 * If price is 0.5% above EMA55, it's considered touching/retesting it.
 */
const EMA55_RETEST_THRESHOLD = 0.005; // 0.5%

export function evaluateS2(
  snap1H: IndicatorSnapshot,
  snap4H: IndicatorSnapshot
): Signal | null {
  const trendBullish = snap4H.ema21 > snap4H.ema55;
  const trendBearish = snap4H.ema21 < snap4H.ema55;

  const { close, ema21, ema55, rsi14, bbwp, pmarp } = snap1H;

  const bbwpOk = bbwp < 35;
  const retestAbove = isRetestFromAbove(close, ema55);
  const retestBelow = isRetestFromBelow(close, ema55);
  const ema55Dist = ema55 !== 0 ? ((close - ema55) / ema55 * 100).toFixed(2) : "?";

  console.log(
    `[S2-diag] BBWP=${bbwp?.toFixed(1) ?? "NaN"}(${bbwpOk ? "ok" : "FAIL"}) ` +
    `PMARP=${pmarp?.toFixed(1) ?? "NaN"} RSI=${rsi14?.toFixed(1) ?? "NaN"} ` +
    `Trend=${trendBullish ? "bull" : trendBearish ? "bear" : "flat"} ` +
    `EMA55dist=${ema55Dist}% retest=${retestAbove ? "above" : retestBelow ? "below" : "none"} ` +
    `1H-EMA=${ema21 > ema55 ? "bull" : "bear"}`
  );

  if (!bbwpOk) return null;

  if (
    trendBullish &&
    pmarp < 50 &&
    retestAbove &&
    ema21 > ema55 &&
    rsi14 >= 35 &&
    rsi14 <= 55
  ) {
    return { direction: "long", strategy: "S2", stopDistancePct: S2_STOP_DISTANCE };
  }

  if (
    trendBearish &&
    pmarp > 50 &&
    retestBelow &&
    ema21 < ema55 &&
    rsi14 >= 45 &&
    rsi14 <= 65
  ) {
    return { direction: "short", strategy: "S2", stopDistancePct: S2_STOP_DISTANCE };
  }

  return null;
}

// ---------------------------------------------------------------------------

/**
 * Price is retesting EMA55 from above:
 * close is above EMA55 but within the retest threshold, OR has just touched it.
 */
function isRetestFromAbove(close: number, ema55: number): boolean {
  const distancePct = (close - ema55) / ema55;
  return distancePct >= 0 && distancePct <= EMA55_RETEST_THRESHOLD;
}

/**
 * Price is retesting EMA55 from below:
 * close is below EMA55 but within the retest threshold.
 */
function isRetestFromBelow(close: number, ema55: number): boolean {
  const distancePct = (ema55 - close) / ema55;
  return distancePct >= 0 && distancePct <= EMA55_RETEST_THRESHOLD;
}

// ---------------------------------------------------------------------------

interface S2ExitState {
  prevPmarp: number | null;
  prevBbwp: number | null;
}

const exitState: S2ExitState = { prevPmarp: null, prevBbwp: null };

/**
 * S2 exit check — call on every 1H candle close while in a S2 position.
 * Returns true if the position should be closed.
 */
export function shouldExitS2(
  snap1H: IndicatorSnapshot,
  snap4H: IndicatorSnapshot,
  positionDirection: "long" | "short"
): boolean {
  const { pmarp, bbwp, ema21, ema55 } = snap1H;
  const prev = exitState;

  // Primary exit: PMARP closed above 85 then closes back below
  const pmarpReversal =
    prev.prevPmarp !== null && prev.prevPmarp >= 85 && pmarp < 85;

  // Volatility expansion exhausted
  const bbwpExpansion = bbwp >= 85;

  // Trend reversal on 4H
  const trendReversed =
    positionDirection === "long"
      ? snap4H.ema21 < snap4H.ema55
      : snap4H.ema21 > snap4H.ema55;

  // Also check 1H EMA cross
  const ema1HReversed =
    positionDirection === "long" ? ema21 < ema55 : ema21 > ema55;

  // Update state
  exitState.prevPmarp = pmarp;
  exitState.prevBbwp = bbwp;

  return pmarpReversal || bbwpExpansion || trendReversed || ema1HReversed;
}

export function resetS2State(): void {
  exitState.prevPmarp = null;
  exitState.prevBbwp = null;
}
