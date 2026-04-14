/**
 * Pure indicator computation from OHLCV close prices.
 *
 * All functions return a same-length array. Bars without sufficient
 * history are filled with NaN (warm-up period).
 *
 * Formulas match TradingView defaults:
 *   EMA      — SMA-seeded exponential moving average
 *   RSI      — Wilder's smoothing (RMA)
 *   StochRSI — Stoch applied to RSI, then SMA-smoothed K and D
 *   BBWP     — Bollinger Band Width Percentile (Chris Moody, period=13, stdDev=1, lookback=252)
 *   PMARP    — Price/SMA Ratio Percentile (period=50, lookback=200)
 *
 * Note: BBWP and PMARP use default TV parameters. If your chart uses
 * different settings, S2 signal counts may differ from live bot.
 */

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/** SMA of `prices` over `period`. Returns NaN before period is reached. */
export function computeSMA(prices: number[], period: number): number[] {
  const result = new Array(prices.length).fill(NaN) as number[];
  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += prices[j];
    result[i] = sum / period;
  }
  return result;
}

/** SMA over an array that may contain NaN — a window is skipped if any element is NaN. */
function smoothSMA(values: number[], period: number): number[] {
  const result = new Array(values.length).fill(NaN) as number[];
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    if (slice.some(Number.isNaN)) continue;
    result[i] = slice.reduce((a, b) => a + b, 0) / period;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Exported indicators
// ---------------------------------------------------------------------------

/**
 * EMA seeded with SMA of the first `period` bars.
 * Matches TradingView's "Exponential Moving Average" indicator.
 */
export function computeEMA(prices: number[], period: number): number[] {
  const result = new Array(prices.length).fill(NaN) as number[];
  if (prices.length < period) return result;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += prices[i];
  result[period - 1] = seed / period;
  for (let i = period; i < prices.length; i++) {
    result[i] = prices[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

/**
 * RSI using Wilder's Relative Moving Average (RMA).
 * Matches TradingView's built-in RSI.
 */
export function computeRSI(prices: number[], period = 14): number[] {
  const result = new Array(prices.length).fill(NaN) as number[];
  if (prices.length < period + 1) return result;

  // Seed: simple average of first `period` changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) avgGain += d;
    else avgLoss += -d;
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  // Wilder smoothing
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

/**
 * Stochastic RSI — applies the Stochastic formula to RSI values,
 * then smooths K with a `kSmooth`-period SMA and D as SMA(K, dSmooth).
 *
 * Default params match TradingView's "Stochastic RSI" indicator:
 *   RSI length = 14, Stochastic length = 14, K smooth = 3, D smooth = 3
 */
export function computeStochRSI(
  prices: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  kSmooth = 3,
  dSmooth = 3,
): { k: number[]; d: number[] } {
  const rsi = computeRSI(prices, rsiPeriod);
  const len = prices.length;
  const rawK = new Array(len).fill(NaN) as number[];

  for (let i = stochPeriod - 1; i < len; i++) {
    const slice = rsi.slice(i - stochPeriod + 1, i + 1);
    if (slice.some(Number.isNaN)) continue;
    const lo = Math.min(...slice);
    const hi = Math.max(...slice);
    rawK[i] = hi === lo ? 50 : ((rsi[i] - lo) / (hi - lo)) * 100;
  }

  const k = smoothSMA(rawK, kSmooth);
  const d = smoothSMA(k, dSmooth);
  return { k, d };
}

/**
 * BBWP — Bollinger Band Width Percentile.
 *
 * Default params match Chris Moody's TV indicator:
 *   bbPeriod = 13, stdDevMult = 1.0, lookback = 252
 *
 * Formula: BBW = (BB_upper - BB_lower) / BB_middle
 *          BBWP = percentile rank of BBW over the past `lookback` bars (0–100)
 */
export function computeBBWP(
  prices: number[],
  bbPeriod = 13,
  stdDevMult = 1.0,
  lookback = 252,
): number[] {
  const len = prices.length;
  const result = new Array(len).fill(NaN) as number[];

  // Step 1: BBW for every bar
  const bbw = new Array(len).fill(NaN) as number[];
  for (let i = bbPeriod - 1; i < len; i++) {
    const slice = prices.slice(i - bbPeriod + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / bbPeriod;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / bbPeriod;
    const std = Math.sqrt(variance);
    bbw[i] = mean !== 0 ? (2 * stdDevMult * std) / mean : 0;
  }

  // Step 2: percentile rank of current BBW over last `lookback` values
  const minIdx = bbPeriod - 1 + lookback - 1;
  for (let i = minIdx; i < len; i++) {
    if (Number.isNaN(bbw[i])) continue;
    const window = bbw.slice(i - lookback + 1, i + 1).filter(v => !Number.isNaN(v));
    if (window.length === 0) continue;
    const rank = window.filter(v => v <= bbw[i]).length / window.length;
    result[i] = rank * 100;
  }
  return result;
}

/**
 * PMARP — Price Moving Average Ratio Percentile.
 *
 * Default params: SMA period = 50, lookback = 200
 *
 * Formula: ratio = close / SMA(close, maPeriod)
 *          PMARP = percentile rank of ratio over last `lookback` bars (0–100)
 *
 * > 50: price high relative to its history → extended
 * < 50: price low relative to its history → compressed
 */
export function computePMARP(
  prices: number[],
  maPeriod = 50,
  lookback = 200,
): number[] {
  const len = prices.length;
  const result = new Array(len).fill(NaN) as number[];
  const sma = computeSMA(prices, maPeriod);

  const ratio = prices.map((p, i) =>
    Number.isNaN(sma[i]) || sma[i] === 0 ? NaN : p / sma[i],
  );

  const minIdx = maPeriod - 1 + lookback - 1;
  for (let i = minIdx; i < len; i++) {
    if (Number.isNaN(ratio[i])) continue;
    const window = ratio.slice(i - lookback + 1, i + 1).filter(v => !Number.isNaN(v));
    if (window.length === 0) continue;
    const rank = window.filter(v => v <= ratio[i]).length / window.length;
    result[i] = rank * 100;
  }
  return result;
}
