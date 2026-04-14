/**
 * Signal confluence scorer
 *
 * Implements the confluence table and macro filter from the strategy KB.
 *
 * Confluence table:
 *   S1 long + S2 long          → 8/10, 5x–7x
 *   S1 active long + S3 long   → 6/10, 5x
 *   S2 entry + S3 confirms     → 5/10, 3x–5x
 *   Single strategy only       → 3/10, 3x
 *   S1 long but S3 short       → 1/10, SKIP
 *   All 3 bearish              → 9/10, 7x–10x
 *
 * Macro filter (Daily EMA200):
 *   Price above 200 EMA → bias long; only S3 shorts allowed
 *   Price below 200 EMA → bias short; only S3 longs allowed
 *   Price within 1% of 200 EMA → 50% position size, unclear trend
 */

import { IndicatorSnapshot } from "../tradingview/reader";
import { Signal, ConfluenceResult, Direction } from "./types";

/**
 * Fixed leverage per strategy (user-configured).
 * S1 = trend-follow (10x), S2 = mean-reversion (8x), S3 = scalp (5x).
 * Priority when multiple strategies align: highest-priority strategy wins (S1 > S2 > S3).
 */
export const STRATEGY_LEVERAGE: Record<"S1" | "S2" | "S3", number> = {
  S1: 10,
  S2: 8,
  S3: 5,
};

/**
 * Returns the leverage to apply for a given set of active signals.
 * Uses the highest-priority strategy present (S1 > S2 > S3).
 */
export function getLeverageForSignals(signals: Signal[]): number {
  const ids = new Set(signals.map((s) => s.strategy));
  if (ids.has("S1")) return STRATEGY_LEVERAGE.S1;
  if (ids.has("S2")) return STRATEGY_LEVERAGE.S2;
  return STRATEGY_LEVERAGE.S3;
}

export function scoreSignals(
  signals: Signal[],
  snapDaily: IndicatorSnapshot
): ConfluenceResult {
  if (signals.length === 0) {
    return { score: 0, direction: null, leverage: 0, riskPercent: 0, signals: [] };
  }

  // Macro filter check
  const macroFilter = getMacroFilter(snapDaily);

  // Filter signals against macro bias
  const filteredSignals = applyMacroFilter(signals, macroFilter);

  if (filteredSignals.length === 0) {
    return { score: 0, direction: null, leverage: 0, riskPercent: 0, signals: [] };
  }

  // All signals must agree on direction (no conflicting signals allowed)
  const directions = new Set(filteredSignals.map((s) => s.direction));
  if (directions.size > 1) {
    // Conflicting signals — NO TRADE (score 1/10 per KB)
    return { score: 1, direction: null, leverage: 0, riskPercent: 0, signals: filteredSignals };
  }

  const direction = filteredSignals[0].direction;
  const strategyIds = new Set(filteredSignals.map((s) => s.strategy));

  const hasS1 = strategyIds.has("S1");
  const hasS2 = strategyIds.has("S2");
  const hasS3 = strategyIds.has("S3");
  const allThree = hasS1 && hasS2 && hasS3;

  let score: number;
  let leverage: number;
  let riskPercent: number;

  if (allThree) {
    // All 3 strategies align (strongest signal)
    score = direction === "short" ? 9 : 8;
    leverage = direction === "short" ? 10 : 8; // 7x–10x short, 7x–8x long
    riskPercent = 0.05; // 5% — high-conviction
  } else if (hasS1 && hasS2) {
    score = 8;
    leverage = 6; // 5x–7x → use 6x
    riskPercent = 0.05;
  } else if (hasS1 && hasS3) {
    score = 6;
    leverage = 5;
    riskPercent = 0.05;
  } else if (hasS2 && hasS3) {
    score = 5;
    leverage = 4; // 3x–5x → use 4x
    riskPercent = 0.02;
  } else {
    // Single strategy only
    score = 3;
    leverage = 3;
    riskPercent = 0.02;
  }

  // Reduce position size if price is within 1% of Daily EMA200
  if (macroFilter.nearEMA200) {
    riskPercent = riskPercent * 0.5;
  }

  return { score, direction, leverage, riskPercent, signals: filteredSignals };
}

// ---------------------------------------------------------------------------

interface MacroFilter {
  bias: Direction | "neutral";
  nearEMA200: boolean;
}

function getMacroFilter(snapDaily: IndicatorSnapshot): MacroFilter {
  const { close, ema200 } = snapDaily;
  const distancePct = Math.abs(close - ema200) / ema200;
  const nearEMA200 = distancePct <= 0.01; // within 1%

  if (close > ema200) return { bias: "long", nearEMA200 };
  if (close < ema200) return { bias: "short", nearEMA200 };
  return { bias: "neutral", nearEMA200: true };
}

/**
 * Applies macro filter rules:
 * - Price above 200 EMA: allow long swings (S1/S2) and S3 shorts
 * - Price below 200 EMA: allow short swings (S1/S2) and S3 longs
 */
function applyMacroFilter(signals: Signal[], macro: MacroFilter): Signal[] {
  if (macro.bias === "neutral") return signals; // allow all, but size will be halved

  return signals.filter((s) => {
    if (macro.bias === "long") {
      // Above 200 EMA: allow long signals from any strategy, but only S3 shorts
      if (s.direction === "short" && s.strategy !== "S3") return false;
    } else if (macro.bias === "short") {
      // Below 200 EMA: allow short signals from any strategy, but only S3 longs
      if (s.direction === "long" && s.strategy !== "S3") return false;
    }
    return true;
  });
}
