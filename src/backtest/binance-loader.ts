/**
 * Binance CSV loader — parses downloaded Binance kline CSVs, aggregates
 * 15m bars into higher timeframes, and computes indicators.
 *
 * Output format matches CollectedData from collector.ts so the existing
 * aligner + engine can consume it directly.
 */

import * as fs from "fs";
import * as path from "path";
import { buildBarData, type CollectedData, type IndicatorParams } from "./collector";
import { aggregateTo1H, aggregateTo4H, aggregateTo1D } from "./aggregator";
import type { Candle } from "./types";

/**
 * Parses a single Binance kline CSV file into Candle[].
 *
 * Binance CSV columns:
 *   0: open_time, 1: open, 2: high, 3: low, 4: close, 5: volume,
 *   6: close_time, 7: quote_vol, 8: count, 9: taker_buy_vol,
 *   10: taker_buy_quote_vol, 11: ignore
 */
function parseCsv(filePath: string): Candle[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(l => l.trim().length > 0);
  const candles: Candle[] = [];

  for (const line of lines) {
    const cols = line.split(",");
    if (cols.length < 6) continue;

    let timestamp = parseInt(cols[0], 10);
    if (Number.isNaN(timestamp)) continue; // skip header if present
    // Binance Data Vision uses microseconds (16 digits), REST API uses milliseconds (13 digits)
    if (timestamp > 1e13) timestamp = Math.floor(timestamp / 1000);

    candles.push({
      timestamp,
      open:   parseFloat(cols[1]),
      high:   parseFloat(cols[2]),
      low:    parseFloat(cols[3]),
      close:  parseFloat(cols[4]),
      volume: parseFloat(cols[5]),
    });
  }

  return candles;
}

/**
 * Validates 15m candle data for gaps > 30 minutes.
 * Returns the number of gaps found (logs each one).
 */
function validateGaps(candles: Candle[]): number {
  const GAP_THRESHOLD = 30 * 60_000; // 30 minutes
  let gaps = 0;

  for (let i = 1; i < candles.length; i++) {
    const diff = candles[i].timestamp - candles[i - 1].timestamp;
    if (diff > GAP_THRESHOLD) {
      gaps++;
      const from = new Date(candles[i - 1].timestamp).toISOString();
      const to = new Date(candles[i].timestamp).toISOString();
      console.log(`  [Gap] ${from} → ${to} (${(diff / 60_000).toFixed(0)} min)`);
    }
  }

  return gaps;
}

/**
 * Loads all Binance CSV files from a directory, parses 15m candles,
 * aggregates to 1H/4H/1D, computes indicators on all timeframes,
 * and returns CollectedData ready for alignment and backtesting.
 *
 * @param dataDir  Path to directory containing BTCUSDT-15m-*.csv files
 * @param warmupBars  Number of 15m bars to use as indicator warmup (default 700)
 */
export async function loadBinanceData(
  dataDir: string,
  warmupBars = 700,
  params?: IndicatorParams,
): Promise<CollectedData> {
  console.log(`[BinanceLoader] Loading CSVs from ${dataDir}...`);

  // Find and sort CSV files
  const files = fs.readdirSync(dataDir)
    .filter(f => f.startsWith("BTCUSDT-15m-") && f.endsWith(".csv"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No BTCUSDT-15m-*.csv files found in ${dataDir}`);
  }

  console.log(`[BinanceLoader] Found ${files.length} CSV files`);

  // Parse all files into one sorted, deduplicated array
  const allCandles: Candle[] = [];
  for (const f of files) {
    const candles = parseCsv(path.join(dataDir, f));
    console.log(`  ${f}: ${candles.length} rows`);
    allCandles.push(...candles);
  }

  // Deduplicate by timestamp
  const seen = new Set<number>();
  const unique = allCandles
    .filter(c => { if (seen.has(c.timestamp)) return false; seen.add(c.timestamp); return true; })
    .sort((a, b) => a.timestamp - b.timestamp);

  console.log(`[BinanceLoader] ${unique.length} unique 15m candles (${allCandles.length - unique.length} duplicates removed)`);

  // Validate
  const gapCount = validateGaps(unique);
  if (gapCount > 0) {
    console.log(`[BinanceLoader] WARNING: ${gapCount} gaps > 30 minutes found`);
  }

  // Date range
  const firstDate = new Date(unique[0].timestamp).toISOString().split("T")[0];
  const lastDate = new Date(unique[unique.length - 1].timestamp).toISOString().split("T")[0];
  console.log(`[BinanceLoader] Date range: ${firstDate} → ${lastDate}`);

  // Aggregate to higher timeframes
  console.log("[BinanceLoader] Aggregating 15m → 1H/4H/1D...");
  const candles1H = aggregateTo1H(unique);
  const candles4H = aggregateTo4H(unique);
  const candles1D = aggregateTo1D(unique);

  console.log(`  1H: ${candles1H.length} bars | 4H: ${candles4H.length} bars | 1D: ${candles1D.length} bars`);

  // Compute indicators on all timeframes
  const pLabel = params?.pmarpPeriod || params?.pmarpLookback
    ? ` (PMARP ${params.pmarpPeriod ?? 50}/${params.pmarpLookback ?? 200})`
    : "";
  console.log(`[BinanceLoader] Computing indicators${pLabel}...`);
  const bars15m = buildBarData(unique, params);
  const bars1H  = buildBarData(candles1H, params);
  const bars4H  = buildBarData(candles4H, params);
  const bars1D  = buildBarData(candles1D, params);

  // Backtest starts after warmup period
  const backtestStartMs = unique[Math.min(warmupBars, unique.length - 1)].timestamp;
  const backtestStartDate = new Date(backtestStartMs).toISOString().split("T")[0];
  console.log(`[BinanceLoader] Backtest start (after ${warmupBars}-bar warmup): ${backtestStartDate}`);

  return { bars15m, bars1H, bars4H, bars1D, backtestStartMs };
}
