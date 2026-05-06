/**
 * Download historical BTC/USDT funding rates from Binance Futures API.
 *
 * Output: data/bt-data/BTCUSDT-funding.csv (fundingTime,fundingRate)
 *
 * Usage: npx ts-node src/scripts/download_funding.ts [--months 24]
 */

import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.resolve(__dirname, "../../data/bt-data");
const BINANCE_FAPI = "https://fapi.binance.com/fapi/v1/fundingRate";
const OUT_FILE = path.join(DATA_DIR, "BTCUSDT-funding.csv");

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

interface FundingRecord {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
  markPrice?: string;
}

async function main(): Promise<void> {
  const monthsArg = process.argv.find(a => a.startsWith("--months="));
  const months = monthsArg ? parseInt(monthsArg.split("=")[1]) : 24;

  const now = Date.now();
  const startTime = new Date();
  startTime.setMonth(startTime.getMonth() - months);
  let cursor = startTime.getTime();

  console.log(`=== Binance Funding Rate Download ===`);
  console.log(`Period: ${months} months (${startTime.toISOString().split("T")[0]} → now)`);
  console.log(`Output: ${OUT_FILE}\n`);

  const allRecords: FundingRecord[] = [];
  const limit = 1000;

  while (cursor < now) {
    const url = `${BINANCE_FAPI}?symbol=BTCUSDT&startTime=${cursor}&limit=${limit}`;
    console.log(`[Fetch] startTime=${new Date(cursor).toISOString().split("T")[0]} ...`);

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Binance API ${res.status}: ${body}`);
    }

    const data = (await res.json()) as FundingRecord[];
    if (data.length === 0) break;

    allRecords.push(...data);
    console.log(`  Got ${data.length} records (total: ${allRecords.length})`);

    cursor = data[data.length - 1].fundingTime + 1;
    if (data.length < limit) break;
    await sleep(300);
  }

  if (allRecords.length === 0) {
    console.log("No funding rate data returned.");
    process.exit(1);
  }

  // Deduplicate by fundingTime
  const seen = new Set<number>();
  const unique = allRecords.filter(r => {
    if (seen.has(r.fundingTime)) return false;
    seen.add(r.fundingTime);
    return true;
  });
  unique.sort((a, b) => a.fundingTime - b.fundingTime);

  // Write CSV
  const header = "fundingTime,fundingRate";
  const rows = unique.map(r => `${r.fundingTime},${r.fundingRate}`);
  fs.writeFileSync(OUT_FILE, [header, ...rows].join("\n") + "\n");

  const firstDate = new Date(unique[0].fundingTime).toISOString().split("T")[0];
  const lastDate = new Date(unique[unique.length - 1].fundingTime).toISOString().split("T")[0];

  console.log(`\n=== SUMMARY ===`);
  console.log(`  Records: ${unique.length}`);
  console.log(`  Range: ${firstDate} → ${lastDate}`);
  console.log(`  Frequency: ~${(unique.length / months).toFixed(0)} per month (expect ~90)`);
  console.log(`  Saved: ${OUT_FILE}`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
