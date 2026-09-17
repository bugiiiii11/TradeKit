/**
 * S52 -- lookahead A/B: legacy alignment vs the fixed one.
 *
 * Until S52 the aligner attached the higher-TF bar that was still FORMING
 * (aggregator.ts timestamps buckets by their start, and the aligner picked
 * "open timestamp <= now"), so every strategy read a 1H/4H/1D close from up to
 * 45min / 3h45m / 23h45m in the future. This script quantifies what that was
 * worth, per strategy and per window, so the archived numbers can be re-read.
 *
 * Usage:
 *   npx ts-node src/scripts/backtest_lookahead_ab.ts \
 *     [--strategies S1,S6] [--test-from 2025-07-01] [--bankroll 358] [--margin 5]
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as path from "path";
import { loadBinanceData } from "../backtest/binance-loader";
import { alignBars } from "../backtest/aligner";
import { runBacktest } from "../backtest/engine";
import type { AlignedBar, BacktestConfig, StrategyId } from "../backtest/types";

function getFlag(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
function getNum(name: string, dflt: number): number {
  const v = getFlag(name, String(dflt));
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

interface Row {
  label: string;
  n: number;
  wr: number;
  pnl: number;
  pf: number;
  days: number;
}

function summarise(label: string, bars: AlignedBar[], cfg: BacktestConfig, strat?: StrategyId): Row {
  const res = runBacktest(bars, cfg);
  const trades = strat ? res.trades.filter(t => t.strategy === strat) : res.trades;
  const wins = trades.filter(t => t.pnlUsd > 0);
  const gross = wins.reduce((a, t) => a + t.pnlUsd, 0);
  const loss = trades.filter(t => t.pnlUsd <= 0).reduce((a, t) => a + Math.abs(t.pnlUsd), 0);
  const days = bars.length
    ? Math.round((bars[bars.length - 1].bar15m.timestamp - bars[0].bar15m.timestamp) / 86400_000)
    : 0;
  return {
    label,
    n: trades.length,
    wr: trades.length ? (wins.length / trades.length) * 100 : 0,
    pnl: trades.reduce((a, t) => a + t.pnlUsd, 0),
    pf: loss > 0 ? gross / loss : Infinity,
    days,
  };
}

function printPair(title: string, legacy: Row, fixed: Row): void {
  console.log(`\n  ${title}  (${fixed.days} days)`);
  console.log(`    ${"".padEnd(8)} ${"trades".padStart(7)} ${"WR".padStart(7)} ${"PF".padStart(7)} ${"PnL".padStart(10)}`);
  const line = (tag: string, r: Row) =>
    console.log(`    ${tag.padEnd(8)} ${String(r.n).padStart(7)} ${r.wr.toFixed(1).padStart(6)}% ${(r.pf === Infinity ? "inf" : r.pf.toFixed(2)).padStart(7)} ${("$" + r.pnl.toFixed(2)).padStart(10)}`);
  line("legacy", legacy);
  line("fixed", fixed);
  const dPnl = fixed.pnl - legacy.pnl;
  const dWr = fixed.wr - legacy.wr;
  console.log(`    delta    ${String(fixed.n - legacy.n).padStart(7)} ${dWr.toFixed(1).padStart(6)}% ${"".padStart(7)} ${("$" + dPnl.toFixed(2)).padStart(10)}  <- what lookahead was worth`);
}

async function main(): Promise<void> {
  const strategies = getFlag("strategies", "S1,S6").split(",").map(s => s.trim()) as StrategyId[];
  const testFrom = getFlag("test-from", "2025-07-01");
  const bankroll = getNum("bankroll", 358);
  const marginPct = getNum("margin", 5) / 100;
  const dataDir = getFlag("data-dir", path.resolve(process.cwd(), "data/bt-data"));
  const testStart = Date.parse(`${testFrom}T00:00:00Z`);

  console.log(`\n=== S52 lookahead A/B ===`);
  console.log(`Strategies: ${strategies.join(", ")} | bankroll $${bankroll} | margin ${(marginPct * 100).toFixed(0)}%`);
  console.log(`Split: train < ${testFrom} <= test\n`);

  const collected = await loadBinanceData(dataDir, 700, { pmarpPeriod: 20, pmarpLookback: 350 });

  const results: Record<string, { train: Row; test: Row; full: Row; perStrat: Record<string, Row> }> = {};

  for (const legacy of [true, false]) {
    const tag = legacy ? "legacy" : "fixed";
    const aligned = alignBars(
      collected.bars15m, collected.bars1H, collected.bars4H, collected.bars1D,
      collected.backtestStartMs, { legacyLookahead: legacy },
    );
    const train = aligned.filter(a => a.bar15m.timestamp < testStart);
    const test = aligned.filter(a => a.bar15m.timestamp >= testStart);
    const mk = (bars: AlignedBar[]): BacktestConfig => ({
      days: bars.length ? Math.round((bars[bars.length - 1].bar15m.timestamp - bars[0].bar15m.timestamp) / 86400_000) : 0,
      bankroll, marginPct, enabledStrategies: strategies,
    });
    const perStrat: Record<string, Row> = {};
    for (const s of strategies) perStrat[s] = summarise(`${tag}:${s}`, test, mk(test), s);
    results[tag] = {
      full: summarise(`${tag}:full`, aligned, mk(aligned)),
      train: summarise(`${tag}:train`, train, mk(train)),
      test: summarise(`${tag}:test`, test, mk(test)),
      perStrat,
    };
  }

  printPair("FULL HISTORY", results.legacy.full, results.fixed.full);
  printPair("TRAIN (in-sample)", results.legacy.train, results.fixed.train);
  printPair("TEST (out-of-sample)", results.legacy.test, results.fixed.test);

  console.log(`\n  TEST window, per strategy`);
  for (const s of strategies) printPair(`  ${s}`, results.legacy.perStrat[s], results.fixed.perStrat[s]);

  console.log(`\n  Read the "fixed" rows as the real expectation. The legacy rows are what`);
  console.log(`  every archived backtest in this repo reported.\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
