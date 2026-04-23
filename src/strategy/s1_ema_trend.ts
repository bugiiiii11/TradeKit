/**
 * Strategy 1: EMA Trend Cross
 *
 * Timeframes: 4H (primary signal) confirmed by Daily
 * Style: Swing trading — catches major trend moves
 * Default leverage: 5x
 *
 * Long: EMA8 crosses above EMA55, EMA13 > EMA55, EMA21 > EMA55, price > EMA200
 * Short: EMA8 crosses below EMA55, EMA13 < EMA55, EMA21 < EMA55, price < EMA200
 * Exit: reverse EMA8/EMA55 cross or stop-loss
 */

import { IndicatorSnapshot } from "../tradingview/reader";
import { Signal } from "./types";
import { sendDiscord, Colors } from "../notifications/discord";

/**
 * S1 stop-loss is placed below/above EMA55 — typically 2–4%.
 * We use 3% as the default stop distance for sizing.
 */
const S1_STOP_DISTANCE = 0.03;

/**
 * Holds the previous 4H snapshot so we can detect a fresh EMA8/EMA55 crossover
 * (cross = EMA8 was below EMA55 last candle, now above, or vice versa).
 */
let prev4H: IndicatorSnapshot | null = null;

export function evaluateS1(
  snap4H: IndicatorSnapshot,
  snapDaily: IndicatorSnapshot
): Signal | null {
  const signal = checkCross(snap4H, snapDaily);
  // Store current as previous for next call
  prev4H = snap4H;
  return signal;
}

/**
 * Resets previous snapshot state (call on bot restart).
 */
export function resetS1State(): void {
  prev4H = null;
}

// ---------------------------------------------------------------------------

function checkCross(
  snap4H: IndicatorSnapshot,
  snapDaily: IndicatorSnapshot
): Signal | null {
  const { close, ema8, ema13, ema21, ema55, ema200 } = snap4H;

  const aboveMacro = snapDaily.close > snapDaily.ema200;
  const belowMacro = snapDaily.close < snapDaily.ema200;

  if (!prev4H) return null;

  const wasBullish = prev4H.ema8 > prev4H.ema55;
  const isBullish = ema8 > ema55;
  const longCross = !wasBullish && isBullish;

  const wasBearish = prev4H.ema8 < prev4H.ema55;
  const isBearish = ema8 < ema55;
  const shortCross = !wasBearish && isBearish;

  const diagMsg =
    `EMA8${isBullish ? ">" : "<"}EMA55 cross=${longCross ? "LONG" : shortCross ? "SHORT" : "none"} ` +
    `EMA13${ema13 > ema55 ? ">" : "<"}55 EMA21${ema21 > ema55 ? ">" : "<"}55 ` +
    `4H-EMA200=${Number.isNaN(ema200) ? "NaN" : (close > ema200 ? "above" : "below")} ` +
    `Daily-EMA200=${Number.isNaN(snapDaily.ema200) ? "NaN" : (aboveMacro ? "above" : "below")}`;
  console.log(`[S1-diag] ${diagMsg}`);
  sendDiscord("signals", `S1 4H Eval\n${diagMsg}`, Colors.orange);

  if (
    longCross &&
    ema13 > ema55 &&
    ema21 > ema55 &&
    close > ema200 &&
    aboveMacro
  ) {
    return { direction: "long", strategy: "S1", stopDistancePct: S1_STOP_DISTANCE };
  }

  if (
    shortCross &&
    ema13 < ema55 &&
    ema21 < ema55 &&
    close < ema200 &&
    belowMacro
  ) {
    return { direction: "short", strategy: "S1", stopDistancePct: S1_STOP_DISTANCE };
  }

  return null;
}

/**
 * S1 exit check — call on every 4H candle close while in a S1 position.
 * Returns true if the position should be closed.
 */
export function shouldExitS1(
  snap4H: IndicatorSnapshot,
  positionDirection: "long" | "short"
): boolean {
  const { ema8, ema55 } = snap4H;

  if (!prev4H) return false;

  if (positionDirection === "long") {
    // Exit: EMA8 crosses back below EMA55
    return prev4H.ema8 > prev4H.ema55 && ema8 < ema55;
  } else {
    // Exit: EMA8 crosses back above EMA55
    return prev4H.ema8 < prev4H.ema55 && ema8 > ema55;
  }
}
