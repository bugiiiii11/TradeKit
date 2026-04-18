/**
 * Phase 0.2 — Download 12 months of BTC/USDT 15m klines from Binance.
 *
 * Uses Binance Data Vision for complete monthly archives, plus REST API
 * for the current partial month.
 *
 * Output: CSV files in data/bt-data/ ready for binance-loader.ts
 *
 * Usage: npx ts-node src/scripts/download_binance.ts [--months 12]
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const DATA_DIR = path.resolve(__dirname, "../../data/bt-data");
const BINANCE_REST = "https://api.binance.com/api/v3/klines";
const BINANCE_VISION = "https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/15m";

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function getMonthRange(months: number): Array<{ year: number; month: number; label: string }> {
  const now = new Date();
  const result: Array<{ year: number; month: number; label: string }> = [];

  for (let i = months; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    result.push({
      year,
      month,
      label: `${year}-${String(month).padStart(2, "0")}`,
    });
  }
  return result;
}

async function downloadMonthlyZip(label: string): Promise<string | null> {
  const zipName = `BTCUSDT-15m-${label}.zip`;
  const csvName = `BTCUSDT-15m-${label}.csv`;
  const csvPath = path.join(DATA_DIR, csvName);
  const zipPath = path.join(DATA_DIR, zipName);

  if (fs.existsSync(csvPath)) {
    const lines = fs.readFileSync(csvPath, "utf-8").split("\n").filter(l => l.trim()).length;
    console.log(`  [Skip] ${csvName} already exists (${lines} rows)`);
    return csvPath;
  }

  const url = `${BINANCE_VISION}/${zipName}`;
  console.log(`  [Download] ${url}`);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) {
        console.log(`  [Warn] ${zipName} not found (month may not be archived yet)`);
        return null;
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(zipPath, buf);
    console.log(`  [Saved] ${zipName} (${(buf.length / 1024).toFixed(0)} KB)`);

    // Extract using PowerShell (Windows) or unzip
    try {
      execSync(
        `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${DATA_DIR}' -Force"`,
        { stdio: "pipe" },
      );
    } catch {
      execSync(`unzip -o "${zipPath}" -d "${DATA_DIR}"`, { stdio: "pipe" });
    }

    if (fs.existsSync(csvPath)) {
      const lines = fs.readFileSync(csvPath, "utf-8").split("\n").filter(l => l.trim()).length;
      console.log(`  [Extracted] ${csvName} (${lines} rows)`);
      fs.unlinkSync(zipPath);
      return csvPath;
    }

    console.log(`  [Warn] Expected ${csvName} not found after extraction`);
    return null;
  } catch (err) {
    console.error(`  [Error] Failed to download ${label}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function downloadCurrentMonthRest(): Promise<string | null> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const label = `${year}-${String(month).padStart(2, "0")}`;
  const csvName = `BTCUSDT-15m-${label}-partial.csv`;
  const csvPath = path.join(DATA_DIR, csvName);

  console.log(`\n[REST] Fetching current month (${label}) via Binance REST API...`);

  const monthStart = new Date(year, now.getMonth(), 1).getTime();
  const rows: string[] = [];
  let startTime = monthStart;
  const limit = 1000;

  while (startTime < Date.now()) {
    const url = `${BINANCE_REST}?symbol=BTCUSDT&interval=15m&startTime=${startTime}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance REST ${res.status}: ${await res.text()}`);

    const data = await res.json() as number[][];
    if (data.length === 0) break;

    for (const k of data) {
      // Format: open_time,open,high,low,close,volume,close_time,quote_vol,count,taker_buy_vol,taker_buy_quote_vol,ignore
      rows.push(k.join(","));
    }

    startTime = (data[data.length - 1][0] as number) + 1;
    console.log(`  [REST] Got ${data.length} candles (total: ${rows.length})`);

    if (data.length < limit) break;
    await sleep(200); // Rate limit courtesy
  }

  if (rows.length === 0) {
    console.log("  [Warn] No data for current month");
    return null;
  }

  fs.writeFileSync(csvPath, rows.join("\n") + "\n");
  console.log(`  [Saved] ${csvName} (${rows.length} rows)`);
  return csvPath;
}

async function main(): Promise<void> {
  const monthsArg = process.argv.find(a => a.startsWith("--months="));
  const months = monthsArg ? parseInt(monthsArg.split("=")[1]) : 12;

  console.log(`=== Phase 0.2: Binance Data Download ===`);
  console.log(`Downloading ${months} months of BTC/USDT 15m klines\n`);

  ensureDir(DATA_DIR);

  // Download archived months
  const monthRange = getMonthRange(months);
  const downloaded: string[] = [];
  let failed = 0;

  for (const m of monthRange) {
    console.log(`\n[${m.label}]`);
    const csvPath = await downloadMonthlyZip(m.label);
    if (csvPath) downloaded.push(csvPath);
    else failed++;
    await sleep(500); // Courtesy delay between downloads
  }

  // Download current partial month via REST
  const currentPath = await downloadCurrentMonthRest();
  if (currentPath) downloaded.push(currentPath);

  // Summary
  console.log("\n=== DOWNLOAD SUMMARY ===");
  console.log(`  Downloaded: ${downloaded.length} files`);
  console.log(`  Failed/skipped: ${failed}`);
  console.log(`  Data directory: ${DATA_DIR}`);

  // Count total rows
  let totalRows = 0;
  for (const f of downloaded) {
    const lines = fs.readFileSync(f, "utf-8").split("\n").filter(l => l.trim()).length;
    totalRows += lines;
  }
  console.log(`  Total rows: ${totalRows.toLocaleString()}`);
  console.log(`  Expected ~${(months * 30 * 96).toLocaleString()} (${months} months × 96 bars/day)`);

  // Validate
  const expectedMin = months * 30 * 96 * 0.9; // 90% of expected
  if (totalRows >= expectedMin) {
    console.log("\n  Data volume looks correct.");
  } else {
    console.log(`\n  [Warn] Data volume lower than expected. Check for missing months.`);
  }

  console.log("\nNext step: run binance-loader.ts to parse CSVs and compute indicators.");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
