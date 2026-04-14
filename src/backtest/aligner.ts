/**
 * Multi-timeframe alignment.
 *
 * For each 15m bar, finds the most recent 1H/4H/1D bar whose open timestamp
 * is ≤ the 15m bar's timestamp. This mirrors how the live bot reads each TF:
 * "the last confirmed close on this timeframe as of now."
 *
 * Bars in the indicator warm-up period (any NaN indicator) are excluded.
 */

import type { BarData, AlignedBar } from "./types";

/** Binary search: last bar in `bars` with timestamp ≤ `ts`. Returns null if none. */
function findAtOrBefore(bars: BarData[], ts: number): BarData | null {
  let lo = 0;
  let hi = bars.length - 1;
  let result: BarData | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].timestamp <= ts) {
      result = bars[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/** True if all indicators that strategies depend on are non-NaN. */
function isFullyWarmedUp(bar: BarData): boolean {
  return (
    !Number.isNaN(bar.ema8)   &&
    !Number.isNaN(bar.ema13)  &&
    !Number.isNaN(bar.ema21)  &&
    !Number.isNaN(bar.ema55)  &&
    !Number.isNaN(bar.ema200) &&
    !Number.isNaN(bar.rsi14)  &&
    !Number.isNaN(bar.stochK) &&
    !Number.isNaN(bar.stochD) &&
    !Number.isNaN(bar.bbwp)   &&
    !Number.isNaN(bar.pmarp)
  );
}

/**
 * Builds an AlignedBar[] from the four raw BarData arrays.
 *
 * Only 15m bars that fall within or after `backtestStartMs` are included
 * (warm-up bars fetched earlier are filtered out here). Additionally,
 * the corresponding 1H/4H/1D bar must also be fully warmed up.
 */
export function alignBars(
  bars15m: BarData[],
  bars1H:  BarData[],
  bars4H:  BarData[],
  bars1D:  BarData[],
  backtestStartMs: number,
): AlignedBar[] {
  const aligned: AlignedBar[] = [];

  for (const b15 of bars15m) {
    // Only include bars within the backtest window
    if (b15.timestamp < backtestStartMs) continue;
    if (!isFullyWarmedUp(b15)) continue;

    const b1H = findAtOrBefore(bars1H, b15.timestamp);
    const b4H = findAtOrBefore(bars4H, b15.timestamp);
    const b1D = findAtOrBefore(bars1D, b15.timestamp);

    if (!b1H || !b4H || !b1D) continue;
    if (!isFullyWarmedUp(b1H) || !isFullyWarmedUp(b4H) || !isFullyWarmedUp(b1D)) continue;

    aligned.push({ bar15m: b15, bar1H: b1H, bar4H: b4H, bar1D: b1D });
  }

  return aligned;
}
