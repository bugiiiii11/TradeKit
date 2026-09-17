/**
 * Multi-timeframe alignment.
 *
 * For each 15m bar, attaches the last CONFIRMED 1H/4H/1D bar -- the most
 * recent one that had already closed by the moment the engine acts, which is
 * the close of that 15m bar (the engine enters at bar15m.close). This mirrors
 * how the live bot reads each TF: "the last confirmed close on this timeframe
 * as of now."
 *
 * S52 fix: this used to attach "the most recent bar whose OPEN timestamp is <=
 * the 15m timestamp". Because aggregator.ts timestamps every bucket by its
 * START, that selected the bar still being FORMED and handed the engine its
 * final close -- up to 45 min of future data on 1H, 3h45m on 4H and 23h45m on
 * 1D. Every strategy read those bars, so every backtest number produced before
 * S52 is inflated by lookahead. `legacyLookahead` reproduces the old numbers
 * for comparison only; never trade on them.
 *
 * Bars in the indicator warm-up period (any NaN indicator) are excluded.
 */

import type { BarData, AlignedBar } from "./types";

const MS_15M = 900_000;
const MS_1H = 3_600_000;
const MS_4H = 14_400_000;
const MS_1D = 86_400_000;

export interface AlignOptions {
  /**
   * Reproduce the pre-S52 lookahead alignment (forming higher-TF bars).
   * Only for comparing against archived backtest numbers.
   */
  legacyLookahead?: boolean;
}

/** Binary search: last bar in `bars` with timestamp <= `ts`. Returns null if none. */
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

/**
 * Last bar that had genuinely CLOSED by `decisionMs`. Bars are timestamped by
 * bucket start, so a bar counts as confirmed only once `timestamp + intervalMs`
 * has passed.
 */
function findLastClosed(bars: BarData[], decisionMs: number, intervalMs: number): BarData | null {
  let lo = 0;
  let hi = bars.length - 1;
  let result: BarData | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].timestamp + intervalMs <= decisionMs) {
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
  opts: AlignOptions = {},
): AlignedBar[] {
  const aligned: AlignedBar[] = [];
  const legacy = opts.legacyLookahead === true;

  for (const b15 of bars15m) {
    // Only include bars within the backtest window
    if (b15.timestamp < backtestStartMs) continue;
    if (!isFullyWarmedUp(b15)) continue;

    // The engine acts at the close of this 15m bar.
    const decisionMs = b15.timestamp + MS_15M;

    const b1H = legacy ? findAtOrBefore(bars1H, b15.timestamp) : findLastClosed(bars1H, decisionMs, MS_1H);
    const b4H = legacy ? findAtOrBefore(bars4H, b15.timestamp) : findLastClosed(bars4H, decisionMs, MS_4H);
    const b1D = legacy ? findAtOrBefore(bars1D, b15.timestamp) : findLastClosed(bars1D, decisionMs, MS_1D);

    if (!b1H || !b4H || !b1D) continue;
    if (!isFullyWarmedUp(b1H) || !isFullyWarmedUp(b4H) || !isFullyWarmedUp(b1D)) continue;

    aligned.push({ bar15m: b15, bar1H: b1H, bar4H: b4H, bar1D: b1D });
  }

  return aligned;
}
