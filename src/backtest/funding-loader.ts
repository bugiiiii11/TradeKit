/**
 * Loads Binance funding rate CSV into a sorted array for backtest lookups.
 *
 * CSV format: fundingTime,fundingRate (header row)
 * Funding settlements are every 8 hours on Binance.
 */

import * as fs from "fs";

export interface FundingRate {
  timestamp: number; // epoch ms (settlement time)
  rate: number;      // e.g. 0.0001 = 0.01%
}

export function loadFundingRates(csvPath: string): FundingRate[] {
  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.split("\n").filter(l => l.trim().length > 0);

  const rates: FundingRate[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.startsWith("fundingTime")) continue;
    const [tsStr, rateStr] = line.split(",");
    const timestamp = parseInt(tsStr);
    const rate = parseFloat(rateStr);
    if (Number.isFinite(timestamp) && Number.isFinite(rate)) {
      rates.push({ timestamp, rate });
    }
  }

  rates.sort((a, b) => a.timestamp - b.timestamp);
  return rates;
}

/**
 * Binary-search for the most recent funding rate at or before `ts`.
 * Returns the rate value, or the default if no rate is found.
 */
export function getFundingRateAt(
  rates: FundingRate[],
  ts: number,
  defaultRate = 0.0001, // 0.01% per 8h
): number {
  if (rates.length === 0) return defaultRate;

  let lo = 0;
  let hi = rates.length - 1;

  if (ts < rates[0].timestamp) return defaultRate;
  if (ts >= rates[hi].timestamp) return rates[hi].rate;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (rates[mid].timestamp <= ts) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return rates[lo].rate;
}
