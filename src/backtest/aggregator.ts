import type { Candle } from "./types";

const MS_1H = 3_600_000;
const MS_4H = 14_400_000;
const MS_1D = 86_400_000;

interface AggregatorConfig {
  intervalMs: number;
  expectedBars: number; // 15m bars per bucket (4, 16, 96)
}

function bucketStart(timestamp: number, intervalMs: number): number {
  return Math.floor(timestamp / intervalMs) * intervalMs;
}

export function aggregate(bars15m: Candle[], config: AggregatorConfig): Candle[] {
  if (bars15m.length === 0) return [];

  const { intervalMs, expectedBars } = config;
  const buckets = new Map<number, Candle[]>();

  for (const bar of bars15m) {
    const key = bucketStart(bar.timestamp, intervalMs);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(bar);
  }

  const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);
  const result: Candle[] = [];

  for (let i = 0; i < sortedKeys.length; i++) {
    const key = sortedKeys[i];
    const bucket = buckets.get(key)!;

    // Skip last bucket if incomplete (partial candle)
    if (i === sortedKeys.length - 1 && bucket.length < expectedBars) continue;

    bucket.sort((a, b) => a.timestamp - b.timestamp);

    result.push({
      timestamp: key,
      open: bucket[0].open,
      high: Math.max(...bucket.map(b => b.high)),
      low: Math.min(...bucket.map(b => b.low)),
      close: bucket[bucket.length - 1].close,
      volume: bucket.reduce((sum, b) => sum + b.volume, 0),
    });
  }

  return result;
}

export function aggregateTo1H(bars15m: Candle[]): Candle[] {
  return aggregate(bars15m, { intervalMs: MS_1H, expectedBars: 4 });
}

export function aggregateTo4H(bars15m: Candle[]): Candle[] {
  return aggregate(bars15m, { intervalMs: MS_4H, expectedBars: 16 });
}

export function aggregateTo1D(bars15m: Candle[]): Candle[] {
  return aggregate(bars15m, { intervalMs: MS_1D, expectedBars: 96 });
}
