/**
 * Fetches BTC OHLCV candles from the Hyperliquid public API and computes
 * all indicator values, producing a BarData[] ready for backtesting.
 *
 * Uses the same exchange as the live bot (Hyperliquid mainnet) so prices
 * match exactly what the bot would have traded.
 *
 * Warmup strategy: fetches EXTRA_WARMUP_DAYS beyond the backtest window so
 * indicators that need a long lookback (BBWP=252 bars, PMARP=200 bars) are
 * fully populated by the first backtest bar.
 */

import {
  computeEMA,
  computeRSI,
  computeStochRSI,
  computeBBWP,
  computePMARP,
} from "./indicators";
import type { Candle, BarData } from "./types";

const HL_API = "https://api.hyperliquid.xyz/info";
const MAX_REQUESTS = 100; // pagination safety cap

/** How many extra days to fetch per TF to warm up the longest-lookback indicators.
 *  Minimum 600 bars per TF: EMA200 needs 3×200=600 for convergence,
 *  PMARP(20,350) needs 370 bars. 700 bars gives comfortable margin. */
const WARMUP_DAYS: Record<string, number> = {
  "15m": 8,   // 700 × 15m ≈ 7.3 days
  "1H":  30,  // 700 × 1h ≈ 29 days
  "4H":  120, // 700 × 4h ≈ 117 days (capped by 52-day API limit → ~312 bars)
  "1D":  270, // 252 + 13 (BB period) daily bars
};

const TF_TO_INTERVAL: Record<string, string> = {
  "15m": "15m",
  "1H":  "1h",
  "4H":  "4h",
  "1D":  "1d",
};

// ---------------------------------------------------------------------------
// Raw API types
// ---------------------------------------------------------------------------

interface RawCandle {
  t: number;             // open time ms
  o: string | number;
  h: string | number;
  l: string | number;
  c: string | number;
  v: string | number;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchPage(
  interval: string,
  startTime: number,
  endTime: number,
): Promise<RawCandle[]> {
  const delays = [3000, 8000, 20000, 40000, 60000]; // retry after 3s, 8s, 20s, 40s, 60s
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: { coin: "BTC", interval, startTime, endTime },
      }),
    });
    if (res.status === 429) {
      if (attempt === delays.length) throw new Error(`Hyperliquid API 429 after ${attempt} retries`);
      const wait = delays[attempt];
      console.log(`[Collector] Rate limited — waiting ${wait / 1000}s (attempt ${attempt + 1}/${delays.length})...`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Hyperliquid API ${res.status}: ${await res.text()}`);
    }
    const data = await res.json() as unknown;
    if (!Array.isArray(data)) throw new Error("Unexpected candle response shape");
    return data as RawCandle[];
  }
  throw new Error("fetchPage: unreachable");
}

/**
 * Fetches all candles for `timeframe` between `startMs` and `endMs` (epoch ms),
 * paginating backwards. Hyperliquid's candleSnapshot anchors to endTime and
 * returns the most-recent N bars within [startTime, endTime]. To get a full
 * multi-month window we must walk the window backwards: after each page, set
 * endTime = firstBar.timestamp - 1 and repeat until we've covered startMs.
 */
export async function fetchCandles(
  timeframe: string,
  startMs: number,
  endMs: number,
): Promise<Candle[]> {
  const interval = TF_TO_INTERVAL[timeframe];
  if (!interval) throw new Error(`Unknown timeframe: ${timeframe}`);

  const all: RawCandle[] = [];
  let windowEnd = endMs;
  let requests = 0;

  while (windowEnd > startMs && requests < MAX_REQUESTS) {
    if (requests > 0) await sleep(1500); // pause between pages to avoid 429
    requests++;
    const page = await fetchPage(interval, startMs, windowEnd);
    if (page.length === 0) break;
    all.push(...page);
    const firstTs = page[0].t;
    if (firstTs <= startMs) break; // covered full range back to startMs
    windowEnd = firstTs - 1;      // move window backwards
  }

  // Deduplicate and sort ascending
  const seen = new Set<number>();
  return all
    .filter(c => { if (seen.has(c.t)) return false; seen.add(c.t); return true; })
    .sort((a, b) => a.t - b.t)
    .map(c => ({
      timestamp: c.t,
      open:   parseFloat(String(c.o)),
      high:   parseFloat(String(c.h)),
      low:    parseFloat(String(c.l)),
      close:  parseFloat(String(c.c)),
      volume: parseFloat(String(c.v)),
    }));
}

// ---------------------------------------------------------------------------
// Indicator computation
// ---------------------------------------------------------------------------

/** Attaches computed indicators to every candle in the array. */
export function buildBarData(candles: Candle[]): BarData[] {
  const closes = candles.map(c => c.close);

  const ema8   = computeEMA(closes, 8);
  const ema13  = computeEMA(closes, 13);
  const ema21  = computeEMA(closes, 21);
  const ema55  = computeEMA(closes, 55);
  const ema200 = computeEMA(closes, 200);
  const rsi14  = computeRSI(closes, 14);
  const { k: stochK, d: stochD } = computeStochRSI(closes);
  const bbwp  = computeBBWP(closes);
  const pmarp = computePMARP(closes);

  return candles.map((c, i) => ({
    ...c,
    ema8:   ema8[i],
    ema13:  ema13[i],
    ema21:  ema21[i],
    ema55:  ema55[i],
    ema200: ema200[i],
    rsi14:  rsi14[i],
    stochK: stochK[i],
    stochD: stochD[i],
    bbwp:   bbwp[i],
    pmarp:  pmarp[i],
  }));
}

// ---------------------------------------------------------------------------
// Public: collect all four timeframes
// ---------------------------------------------------------------------------

export interface CollectedData {
  bars15m: BarData[];
  bars1H:  BarData[];
  bars4H:  BarData[];
  bars1D:  BarData[];
  backtestStartMs: number;
}

/**
 * Fetches and builds BarData for all four timeframes.
 * Each TF fetches extra warmup days so indicators are valid at the
 * backtest start boundary.
 *
 * @param backtestDays  How many days of backtest data (the visible window)
 * @param endMs         End timestamp (default: now)
 */
export async function collectAllTimeframes(
  backtestDays: number,
  endMs: number = Date.now(),
): Promise<CollectedData> {
  const backtestStartMs = endMs - backtestDays * 24 * 60 * 60 * 1000;

  const fetchTF = async (tf: string): Promise<BarData[]> => {
    const warmup = (WARMUP_DAYS[tf] ?? 30) * 24 * 60 * 60 * 1000;
    const startMs = backtestStartMs - warmup;
    console.log(`[Collector] Fetching ${tf} candles (${backtestDays + (WARMUP_DAYS[tf] ?? 30)} days)...`);
    const candles = await fetchCandles(tf, startMs, endMs);
    console.log(`[Collector]   → ${candles.length} candles received`);
    return buildBarData(candles);
  };

  // Fetch sequentially to avoid Hyperliquid 429 rate limits
  const bars15m = await fetchTF("15m");
  await sleep(3000);
  const bars1H = await fetchTF("1H");
  await sleep(3000);
  const bars4H = await fetchTF("4H");
  await sleep(3000);
  const bars1D = await fetchTF("1D");

  return { bars15m, bars1H, bars4H, bars1D, backtestStartMs };
}
