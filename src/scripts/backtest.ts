/**
 * Backtesting script — replay S1/S2/S3 strategies on historical BTC data.
 *
 * Usage:
 *   npx ts-node src/scripts/backtest.ts
 *   npx ts-node src/scripts/backtest.ts --days 180
 *   npx ts-node src/scripts/backtest.ts --days 30 --bankroll 1000
 *
 * Flags:
 *   --days     <n>     Backtest window in days (default: 90)
 *   --bankroll <n>     Starting bankroll in USD (default: env BANKROLL or 500)
 *   --margin   <n>     Margin per trade as % of bankroll (default: 5)
 *
 * Data source: Hyperliquid public candle API (same exchange as live bot).
 * Results saved to: backtest-results.json in project root.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { collectAllTimeframes } from "../backtest/collector";
import { alignBars }            from "../backtest/aligner";
import { runBacktest }           from "../backtest/engine";
import { printResults, saveResultsToFile, saveToSupabase } from "../backtest/reporter";
import type { BacktestConfig }   from "../backtest/types";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function getFlag(name: string, defaultVal: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : defaultVal;
}

function getNumFlag(name: string, defaultVal: number): number {
  const raw = getFlag(name, String(defaultVal));
  const n   = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const days      = getNumFlag("days",     90);
  const bankroll  = getNumFlag("bankroll", parseFloat(process.env.BANKROLL ?? "500") || 500);
  const marginPct = getNumFlag("margin",   5) / 100;

  const config: BacktestConfig = { days, bankroll, marginPct };

  console.log(`\n[Backtest] Starting — ${days}-day window, $${bankroll} bankroll`);
  console.log(`[Backtest] Fetching candles from Hyperliquid...`);

  const t0 = Date.now();

  // Step 1: collect
  const collected = await collectAllTimeframes(days);
  console.log(`[Backtest] Data fetched in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Step 2: align
  const aligned = alignBars(
    collected.bars15m,
    collected.bars1H,
    collected.bars4H,
    collected.bars1D,
    collected.backtestStartMs,
  );
  console.log(`[Backtest] Aligned bars: ${aligned.length} (${days}-day window)`);

  if (aligned.length === 0) {
    console.error("[Backtest] ❌ No aligned bars — not enough historical data.");
    console.error("           Try increasing --days or check your internet connection.");
    process.exit(1);
  }

  // Step 3: replay
  console.log(`[Backtest] Running strategy replay...`);
  const result = runBacktest(aligned, config);
  console.log(`[Backtest] Replay complete — ${result.trades.length} trades`);

  // Step 4: output
  printResults(result);
  const outPath = saveResultsToFile(result);
  console.log(`[Backtest] Results saved to: ${outPath}`);

  // Step 5: persist to Supabase (for Vercel production)
  await saveToSupabase(result);
  console.log("");
}

main().catch(err => {
  console.error("[Backtest] ❌ FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
