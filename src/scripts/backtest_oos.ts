/**
 * Sprint 2 (S51) — out-of-sample truth table. Audit items G3 + G5.
 *
 * Loads the Binance dataset once, splits it into a train (in-sample) and a test
 * (out-of-sample) window, and replays a matrix of strategy configurations on both.
 * Prints one table so train and test sit side by side per configuration.
 *
 * Why this exists: every backtest in the archive was in-sample. S6's lookback=40 and
 * S1's filters were chosen on the same window they were then validated on, which is the
 * textbook way to get a strategy that backtests well and loses live. Nothing here fits
 * parameters — the test column is report-only.
 *
 * Usage:
 *   npx ts-node src/scripts/backtest_oos.ts
 *   npx ts-node src/scripts/backtest_oos.ts --train-until 2025-07-01 --test-from 2025-07-01
 *   npx ts-node src/scripts/backtest_oos.ts --bankroll 500 --margin 5
 *
 * Flags:
 *   --bankroll    <n>           Starting bankroll per window (default: 500)
 *   --margin      <n>           Margin per trade as % of bankroll (default: 5)
 *   --data-dir    <path>        Binance CSV directory (default: ./data/bt-data)
 *   --train-until <YYYY-MM-DD>  End of train window, exclusive (default: 2025-07-01)
 *   --test-from   <YYYY-MM-DD>  Start of test window, inclusive (default: 2025-07-01)
 *   --pmarp-period   <n>        (default: 20 — the live value)
 *   --pmarp-lookback <n>        (default: 350 — the live value)
 *   --legacy-lookahead          Re-align with the pre-S52 lookahead bug, to reproduce
 *                               the archived (inflated) numbers for comparison.
 *
 * Both windows start from the same bankroll so their PnL is comparable rather than
 * compounded end to end.
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as path from "path";
import { loadBinanceData } from "../backtest/binance-loader";
import { alignBars } from "../backtest/aligner";
import { runBacktest } from "../backtest/engine";
import type { BacktestConfig, StrategyId } from "../backtest/types";
import type { IndicatorParams } from "../backtest/collector";

type Aligned = ReturnType<typeof alignBars>;

interface Scenario {
  label: string;
  strategies: StrategyId[];
  regimeFilter?: boolean;
  regimeFilterStrategies?: StrategyId[];
  regimeBlockWhen?: "trending" | "sideways";
}

interface WindowStats {
  trades: number;
  winRate: number;
  pnlUsd: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sharpe: number | null;
}

function getFlag(name: string, defaultVal: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : defaultVal;
}

function getNumFlag(name: string, defaultVal: number): number {
  const n = parseFloat(getFlag(name, String(defaultVal)));
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

function parseDate(flag: string, value: string): number {
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms)) {
    console.error(`[OOS] --${flag} is not a valid YYYY-MM-DD date: ${value}`);
    process.exit(1);
  }
  return ms;
}

function windowDays(w: Aligned): number {
  if (w.length === 0) return 0;
  return Math.round(
    (w[w.length - 1].bar15m.timestamp - w[0].bar15m.timestamp) / (24 * 60 * 60_000),
  );
}

function describe(w: Aligned): string {
  if (w.length === 0) return "empty";
  const a = new Date(w[0].bar15m.timestamp).toISOString().split("T")[0];
  const b = new Date(w[w.length - 1].bar15m.timestamp).toISOString().split("T")[0];
  return `${a} → ${b} (${windowDays(w)}d, ${w.length} bars)`;
}

/**
 * Replays one scenario. The strategy modules log a diagnostic line per bar
 * (S1/S2/S3-diag); across a 9-scenario matrix that is millions of lines, so
 * stdout is muted for the duration of the replay only.
 */
function run(w: Aligned, sc: Scenario, bankroll: number, marginPct: number): WindowStats {
  const config: BacktestConfig = {
    days: windowDays(w),
    bankroll,
    marginPct,
    enabledStrategies: sc.strategies,
    regimeFilter: sc.regimeFilter,
    regimeFilterStrategies: sc.regimeFilterStrategies,
    regimeBlockWhen: sc.regimeBlockWhen,
  };
  const origLog = console.log;
  console.log = () => {};
  let stats;
  try {
    ({ stats } = runBacktest(w, config));
  } finally {
    console.log = origLog;
  }
  return {
    trades: stats.totalTrades,
    winRate: stats.winRate,
    pnlUsd: stats.totalPnlUsd,
    profitFactor: stats.profitFactor,
    maxDrawdownPct: stats.maxDrawdownPct,
    sharpe: stats.sharpeRatio,
  };
}

function fmt(s: WindowStats): string {
  const pf = Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "inf";
  const sh = s.sharpe === null ? "  n/a" : s.sharpe.toFixed(2).padStart(5);
  return [
    String(s.trades).padStart(6),
    `${(s.winRate * 100).toFixed(0)}%`.padStart(5),
    `${s.pnlUsd >= 0 ? "+" : ""}$${s.pnlUsd.toFixed(2)}`.padStart(9),
    pf.padStart(5),
    `${s.maxDrawdownPct.toFixed(1)}%`.padStart(7),
    sh,
  ].join(" ");
}

async function main(): Promise<void> {
  const bankroll = getNumFlag("bankroll", 500);
  const marginPct = getNumFlag("margin", 5) / 100;
  const dataDir = getFlag("data-dir", path.resolve(process.cwd(), "data/bt-data"));
  const pmarpPeriod = getNumFlag("pmarp-period", 20);
  const pmarpLookback = getNumFlag("pmarp-lookback", 350);
  const legacyLookahead = process.argv.includes("--legacy-lookahead");
  const trainUntilMs = parseDate("train-until", getFlag("train-until", "2025-07-01"));
  const testFromMs = parseDate("test-from", getFlag("test-from", "2025-07-01"));

  const indicatorParams: IndicatorParams = { pmarpPeriod, pmarpLookback };

  console.log(`\n[OOS] Out-of-sample truth table (G3 + G5)`);
  console.log(`[OOS] Bankroll $${bankroll} per window | Margin ${(marginPct * 100).toFixed(0)}%`);
  console.log(`[OOS] PMARP period=${pmarpPeriod} lookback=${pmarpLookback}`);
  console.log(`[OOS] Data dir: ${dataDir}`);
  console.log(
    legacyLookahead
      ? `[OOS] Alignment: LEGACY (pre-S52 lookahead) — archived numbers, NOT a forecast`
      : `[OOS] Alignment: fixed (last confirmed higher-TF close, matches the live bot)`,
  );

  const collected = await loadBinanceData(dataDir, 700, indicatorParams);
  const aligned = alignBars(
    collected.bars15m,
    collected.bars1H,
    collected.bars4H,
    collected.bars1D,
    collected.backtestStartMs,
    { legacyLookahead },
  );
  if (aligned.length === 0) {
    console.error("[OOS] No aligned bars — check the data directory.");
    process.exit(1);
  }

  const train = aligned.filter(a => a.bar15m.timestamp < trainUntilMs);
  const test = aligned.filter(a => a.bar15m.timestamp >= testFromMs);

  console.log(`\n[OOS] Full:  ${describe(aligned)}`);
  console.log(`[OOS] Train: ${describe(train)}`);
  console.log(`[OOS] Test:  ${describe(test)}`);

  if (train.length === 0 || test.length === 0) {
    console.error("\n[OOS] One window is empty — the split dates fall outside the data range.");
    process.exit(1);
  }

  const scenarios: Scenario[] = [
    { label: "S1 only", strategies: ["S1"] },
    { label: "S2 only", strategies: ["S2"] },
    { label: "S3 only", strategies: ["S3"] },
    { label: "S6 only", strategies: ["S6"] },
    { label: "S1 + S6 (live set)", strategies: ["S1", "S6"] },
    { label: "S1 + S2 + S6", strategies: ["S1", "S2", "S6"] },
    { label: "All (S1+S2+S3+S6)", strategies: ["S1", "S2", "S3", "S6"] },
    {
      // G5: S6 is a breakout strategy, so it is gated on "sideways" — the chop where
      // breakouts fail. Gating it on "trending" (the S3 polarity) would block the moves
      // it exists to catch.
      label: "S6 + regime (block chop)",
      strategies: ["S6"],
      regimeFilter: true,
      regimeFilterStrategies: ["S6"],
      regimeBlockWhen: "sideways",
    },
    {
      label: "S1 + S6 + regime on S6",
      strategies: ["S1", "S6"],
      regimeFilter: true,
      regimeFilterStrategies: ["S6"],
      regimeBlockWhen: "sideways",
    },
  ];

  const header = `${"".padEnd(26)} ${"Trades".padStart(6)} ${"WR".padStart(5)} ${"PnL".padStart(9)} ${"PF".padStart(5)} ${"MaxDD".padStart(7)} ${"Shrp".padStart(5)}`;

  const rows: Array<{ label: string; train: WindowStats; test: WindowStats }> = [];
  for (const sc of scenarios) {
    process.stdout.write(`[OOS] Replaying ${sc.label} ...\r`);
    rows.push({ label: sc.label, train: run(train, sc, bankroll, marginPct), test: run(test, sc, bankroll, marginPct) });
  }

  console.log(`\n\n=== TRAIN (in-sample) — ${describe(train)} ===`);
  console.log(header);
  for (const r of rows) console.log(`${r.label.padEnd(26)} ${fmt(r.train)}`);

  console.log(`\n=== TEST (out-of-sample) — ${describe(test)} ===`);
  console.log(header);
  for (const r of rows) console.log(`${r.label.padEnd(26)} ${fmt(r.test)}`);

  console.log(`\n=== VERDICT (test window only) ===`);
  for (const r of rows) {
    const t = r.test;
    const verdict =
      t.trades < 30
        ? `INSUFFICIENT (${t.trades} trades, need 30+)`
        : t.profitFactor > 1.3 && t.pnlUsd > 0
          ? "EDGE HOLDS OUT-OF-SAMPLE"
          : t.pnlUsd > 0
            ? "MARGINAL (positive but PF <= 1.3)"
            : "NO EDGE";
    console.log(`  ${r.label.padEnd(26)} ${verdict}`);
  }
  console.log(
    `\n  Decay check: a configuration whose test PnL is far below its train PnL was fitted to the train window.`,
  );
  console.log("");
}

main().catch(err => {
  console.error("[OOS] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
