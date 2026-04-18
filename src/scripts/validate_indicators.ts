/**
 * Phase 0.1 — Indicator Parity Validation
 *
 * Compares locally computed indicators against TradingView's live values
 * to confirm we can go headless without signal drift.
 *
 * Requires: TradingView Desktop running with CDP on port 9222.
 *
 * Usage: npx ts-node src/scripts/validate_indicators.ts
 */

import "dotenv/config";
import { TradingViewMCP } from "../mcp/client";
import { fetchSnapshot, type Timeframe, type IndicatorSnapshot } from "../tradingview/reader";
import { fetchCandles, buildBarData } from "../backtest/collector";
import { computePMARP } from "../backtest/indicators";
import type { BarData } from "../backtest/types";

const TIMEFRAMES: Timeframe[] = ["15m", "1H", "4H", "1D"];

const WARMUP_BARS: Record<Timeframe, number> = {
  "15m": 700,
  "1H":  700,
  "4H":  700,
  "1D":  700,
};

const TF_TO_BAR_MS: Record<Timeframe, number> = {
  "15m": 15 * 60_000,
  "1H":  60 * 60_000,
  "4H":  4 * 60 * 60_000,
  "1D":  24 * 60 * 60_000,
};

const PASS_THRESHOLD = 0.5; // percent
const STOCH_THRESHOLD = 1.0; // StochRSI more sensitive

interface CompareRow {
  timeframe: string;
  indicator: string;
  tvValue: number;
  localValue: number;
  diff: number;
  pctDiff: number;
  status: string;
}

function pctDiff(a: number, b: number): number {
  if (a === 0 && b === 0) return 0;
  const denom = Math.abs(a) || Math.abs(b);
  return Math.abs(a - b) / denom * 100;
}

function getThreshold(indicator: string): number {
  if (indicator === "stochK" || indicator === "stochD") return STOCH_THRESHOLD;
  return PASS_THRESHOLD;
}

function compareIndicators(
  tf: Timeframe,
  tv: IndicatorSnapshot,
  local: BarData,
): CompareRow[] {
  const pairs: [string, number, number][] = [
    ["ema8",   tv.ema8,   local.ema8],
    ["ema13",  tv.ema13,  local.ema13],
    ["ema21",  tv.ema21,  local.ema21],
    ["ema55",  tv.ema55,  local.ema55],
    ["ema200", tv.ema200, local.ema200],
    ["rsi14",  tv.rsi14,  local.rsi14],
    ["stochK", tv.stochK, local.stochK],
    ["stochD", tv.stochD, local.stochD],
    ["bbwp",   tv.bbwp,   local.bbwp],
    ["pmarp",  tv.pmarp,  local.pmarp],
  ];

  return pairs.map(([name, tvVal, localVal]) => {
    const diff = Math.abs(tvVal - localVal);
    const pd = pctDiff(tvVal, localVal);
    const threshold = getThreshold(name);
    return {
      timeframe: tf,
      indicator: name,
      tvValue: tvVal,
      localValue: localVal,
      diff,
      pctDiff: pd,
      status: Number.isNaN(localVal) ? "WARMUP" : pd <= threshold ? "PASS" : "FAIL",
    };
  });
}

function printTable(rows: CompareRow[]): void {
  console.log("");
  console.log(
    "Timeframe".padEnd(10) +
    "Indicator".padEnd(12) +
    "TradingView".padStart(14) +
    "Local".padStart(14) +
    "Diff".padStart(10) +
    "% Diff".padStart(10) +
    "Status".padStart(10)
  );
  console.log("-".repeat(80));

  for (const r of rows) {
    const mark = r.status === "FAIL" ? " <<<" : "";
    console.log(
      r.timeframe.padEnd(10) +
      r.indicator.padEnd(12) +
      r.tvValue.toFixed(4).padStart(14) +
      r.localValue.toFixed(4).padStart(14) +
      r.diff.toFixed(4).padStart(10) +
      (r.pctDiff.toFixed(2) + "%").padStart(10) +
      r.status.padStart(10) +
      mark
    );
  }
  console.log("");
}

async function tryPmarpParams(
  tf: Timeframe,
  tvPmarp: number,
  closes: number[],
): Promise<void> {
  const configs = [
    { label: "default (50,200)", maPeriod: 50, lookback: 200 },
    { label: "KB (20,350)",      maPeriod: 20, lookback: 350 },
    { label: "alt (20,200)",     maPeriod: 20, lookback: 200 },
    { label: "alt (50,350)",     maPeriod: 50, lookback: 350 },
  ];

  console.log(`\n  PMARP parameter sweep for ${tf} (TV value: ${tvPmarp.toFixed(4)}):`);
  for (const cfg of configs) {
    const vals = computePMARP(closes, cfg.maPeriod, cfg.lookback);
    const last = vals[vals.length - 1];
    const pd = pctDiff(tvPmarp, last);
    const status = Number.isNaN(last) ? "WARMUP" : pd <= PASS_THRESHOLD ? "MATCH" : "";
    console.log(`    ${cfg.label.padEnd(20)} → ${(Number.isNaN(last) ? "NaN" : last.toFixed(4)).padStart(10)}  (${pd.toFixed(2)}% diff) ${status}`);
  }
}

async function main(): Promise<void> {
  console.log("=== Phase 0.1: Indicator Parity Validation ===\n");

  const mcp = new TradingViewMCP();
  await mcp.connect();
  console.log("[Validate] MCP connected\n");

  const allRows: CompareRow[] = [];
  const pmarpFailures: { tf: Timeframe; tvPmarp: number; closes: number[] }[] = [];

  for (const tf of TIMEFRAMES) {
    console.log(`[Validate] --- ${tf} ---`);

    // 1. Get TradingView ground truth
    console.log(`[Validate] Fetching TV snapshot for ${tf}...`);
    const tvSnap = await fetchSnapshot(mcp, tf);
    console.log(`[Validate] TV ${tf}: close=${tvSnap.close}, ema8=${tvSnap.ema8.toFixed(2)}, rsi=${tvSnap.rsi14.toFixed(2)}, bbwp=${tvSnap.bbwp.toFixed(2)}, pmarp=${tvSnap.pmarp.toFixed(2)}`);

    // 2. Fetch candles from Hyperliquid with warmup
    const barsNeeded = WARMUP_BARS[tf];
    const barMs = TF_TO_BAR_MS[tf];
    const endMs = Date.now();
    const startMs = endMs - barsNeeded * barMs;
    console.log(`[Validate] Fetching ${barsNeeded} ${tf} candles from Hyperliquid...`);
    const candles = await fetchCandles(tf, startMs, endMs);
    console.log(`[Validate] Got ${candles.length} candles`);

    if (candles.length < 100) {
      console.log(`[Validate] Insufficient candles for ${tf} — skipping`);
      continue;
    }

    // 3. Compute indicators locally
    const bars = buildBarData(candles);
    const lastBar = bars[bars.length - 1];

    console.log(`[Validate] Local ${tf}: close=${lastBar.close}, ema8=${lastBar.ema8.toFixed(2)}, rsi=${lastBar.rsi14.toFixed(2)}, bbwp=${lastBar.bbwp.toFixed(2)}, pmarp=${lastBar.pmarp.toFixed(2)}`);

    // 4. Compare
    const rows = compareIndicators(tf, tvSnap, lastBar);
    allRows.push(...rows);

    // Track PMARP failures for parameter sweep
    const pmarpRow = rows.find(r => r.indicator === "pmarp");
    if (pmarpRow && pmarpRow.status === "FAIL") {
      pmarpFailures.push({
        tf,
        tvPmarp: tvSnap.pmarp,
        closes: candles.map(c => c.close),
      });
    }

    // Pause between TFs to avoid rate limits
    if (tf !== TIMEFRAMES[TIMEFRAMES.length - 1]) {
      console.log("[Validate] Pausing 3s between timeframes...");
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Print results
  console.log("\n=== RESULTS ===");
  printTable(allRows);

  // PMARP parameter sweep on failures
  if (pmarpFailures.length > 0) {
    console.log("=== PMARP PARAMETER SWEEP (finding correct params) ===");
    for (const fail of pmarpFailures) {
      await tryPmarpParams(fail.tf, fail.tvPmarp, fail.closes);
    }
  }

  // Summary
  const failures = allRows.filter(r => r.status === "FAIL");
  const warmups = allRows.filter(r => r.status === "WARMUP");
  const passes = allRows.filter(r => r.status === "PASS");

  console.log("\n=== SUMMARY ===");
  console.log(`  PASS: ${passes.length}/${allRows.length}`);
  console.log(`  FAIL: ${failures.length}/${allRows.length}`);
  console.log(`  WARMUP (insufficient history): ${warmups.length}/${allRows.length}`);

  if (failures.length === 0) {
    console.log("\n  ✓ All indicators match TradingView within tolerance.");
    console.log("  → Phase 0.1 PASSED — local computation is safe for headless bot.");
  } else {
    console.log("\n  ✗ Some indicators diverge. Check parameter sweep results above.");
    console.log("  → Fix parameters before proceeding to Phase 1.");
    for (const f of failures) {
      console.log(`    - ${f.timeframe} ${f.indicator}: TV=${f.tvValue.toFixed(4)} vs Local=${f.localValue.toFixed(4)} (${f.pctDiff.toFixed(2)}%)`);
    }
  }

  await mcp.close();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
