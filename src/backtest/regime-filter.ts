/**
 * Daily EMA regime filter for backtesting.
 *
 * Adapted from Flash's regimeFilter.ts — detects trending markets where
 * mean-reversion strategies (S3 StochRSI scalp) accumulate losses.
 *
 * Logic: price >2% from EMA5d AND 5d-21d gap widening >10% over 3 days
 * = trending regime = block S3 entry.
 */

import { computeEMA } from "./indicators";
import type { BarData } from "./types";

export interface RegimeInfo {
  trending: boolean;
  regime: "sideways" | "trending_up" | "trending_down";
  ema5d: number;
  ema21d: number;
  priceDeviation: number;
}

/**
 * Pre-computes regime state for every daily bar.
 * Returns a Map keyed by daily bar timestamp.
 *
 * Uses the same daily bars already available in the backtest pipeline
 * (extracted from AlignedBar.bar1D), so no additional data fetch needed.
 */
export function computeRegimeMap(
  dailyBars: BarData[],
): Map<number, RegimeInfo> {
  const closes = dailyBars.map(b => b.close);
  const ema5 = computeEMA(closes, 5);
  const ema21 = computeEMA(closes, 21);

  const result = new Map<number, RegimeInfo>();

  for (let i = 0; i < dailyBars.length; i++) {
    if (isNaN(ema5[i]) || isNaN(ema21[i])) {
      result.set(dailyBars[i].timestamp, {
        trending: false,
        regime: "sideways",
        ema5d: ema5[i],
        ema21d: ema21[i],
        priceDeviation: 0,
      });
      continue;
    }

    const price = dailyBars[i].close;
    const e5 = ema5[i];
    const e21 = ema21[i];

    // Condition 1: price >2% from 5d EMA (far from short-term mean)
    const priceDeviation = Math.abs(price - e5) / e5;
    const isFarFrom5d = priceDeviation > 0.02;

    // Condition 2: 5d-21d EMA gap widening >10% over 3 days
    let isDiverging = false;
    if (i >= 3 && !isNaN(ema5[i - 3]) && !isNaN(ema21[i - 3])) {
      const currentGap = Math.abs(e5 - e21);
      const previousGap = Math.abs(ema5[i - 3] - ema21[i - 3]);
      isDiverging = previousGap > 0 && currentGap > previousGap * 1.1;
    }

    const trending = isFarFrom5d && isDiverging;
    const regime = trending
      ? price > e5
        ? "trending_up"
        : "trending_down"
      : "sideways";

    result.set(dailyBars[i].timestamp, {
      trending,
      regime,
      ema5d: e5,
      ema21d: e21,
      priceDeviation,
    });
  }

  return result;
}
