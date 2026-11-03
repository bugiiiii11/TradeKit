/**
 * Throwaway (Landscape v1, seat B, Round 2). Train/test replay of S1-only, S6-only, S1+S6 on a data dir,
 * dumping every trade (notional, pnl, funding, direction, times) so fee and funding sensitivities can be
 * recomputed offline. Does NOT persist anywhere. Same split and parameters as backtest_oos.ts.
 *
 * Usage: npx ts-node docs/collab/landscape-v1/scripts/B/bt_oos_trades.ts --data-dir <dir> --out <json>
 *          [--hl-funding <hl_funding_btc.json>] [--test-to 2026-09-18]
 */
import * as fs from "fs";
import * as path from "path";
import { loadBinanceData } from "../../../../../src/backtest/binance-loader";
import { alignBars } from "../../../../../src/backtest/aligner";
import { runBacktest } from "../../../../../src/backtest/engine";
import type { StrategyId, BacktestConfig } from "../../../../../src/backtest/types";
import type { FundingRate } from "../../../../../src/backtest/funding-loader";
function flag(n: string, d: string) { const i = process.argv.indexOf(`--${n}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; }
(async () => {
  const dataDir = flag("data-dir", path.resolve(process.cwd(), "data/bt-data"));
  const out = flag("out", "bt_oos_trades.json");
  const split = Date.parse("2025-07-01T00:00:00Z");
  const testTo = flag("test-to", "") ? Date.parse(`${flag("test-to", "")}T00:00:00Z`) : Infinity;
  let fundingRates: FundingRate[] | undefined;
  const hlf = flag("hl-funding", "");
  if (hlf) {
    // Hyperliquid fundingHistory is hourly; the engine divides an "8h rate" by 8 per hour, so pass hourly*8.
    const raw = JSON.parse(fs.readFileSync(hlf, "utf-8")) as Array<{ time: number; fundingRate: string }>;
    fundingRates = raw.map(r => ({ timestamp: r.time, rate: parseFloat(r.fundingRate) * 8 })).sort((a, b) => a.timestamp - b.timestamp);
  }
  const col = await loadBinanceData(dataDir, 700, { pmarpPeriod: 20, pmarpLookback: 350 });
  const aligned = alignBars(col.bars15m, col.bars1H, col.bars4H, col.bars1D, col.backtestStartMs);
  const train = aligned.filter(a => a.bar15m.timestamp < split);
  const test = aligned.filter(a => a.bar15m.timestamp >= split && a.bar15m.timestamp < testTo);
  const result: Record<string, any> = { dataDir, hlFunding: !!hlf, testTo: flag("test-to", "end"), windows: {} };
  for (const [wname, bars] of [["train", train], ["test", test]] as const) {
    const days = Math.round((bars[bars.length - 1].bar15m.timestamp - bars[0].bar15m.timestamp) / 86400000);
    result.windows[wname] = { from: new Date(bars[0].bar15m.timestamp).toISOString().slice(0, 10), to: new Date(bars[bars.length - 1].bar15m.timestamp).toISOString().slice(0, 10), days, sets: {} };
    for (const set of [["S1"], ["S6"], ["S1", "S6"]] as StrategyId[][]) {
      const cfg: BacktestConfig = { days, bankroll: 500, marginPct: 0.05, enabledStrategies: set, fundingRates };
      const r = runBacktest(bars, cfg);
      const s = r.stats;
      result.windows[wname].sets[set.join("+")] = {
        stats: { n: s.totalTrades, wr: s.winRate, pnl: s.totalPnlUsd, pf: s.profitFactor, maxDDPct: s.maxDrawdownPct, sharpe: s.sharpeRatio, avgWin: s.avgWinUsd, avgLoss: s.avgLossUsd },
        trades: r.trades.map(t => ({ s: t.strategy, d: t.direction, e: t.entryTimestamp, x: t.exitTimestamp, ep: t.entryPrice, xp: t.exitPrice, n: t.notionalUsd, pnl: t.pnlUsd, f: t.fundingPnl, r: t.exitReason })),
      };
      console.log(`${wname} ${set.join("+")}: n=${s.totalTrades} pnl=${s.totalPnlUsd.toFixed(2)} pf=${s.profitFactor.toFixed(2)} dd=${s.maxDrawdownPct.toFixed(1)}%`);
    }
  }
  fs.writeFileSync(out, JSON.stringify(result));
  console.log("wrote", out);
})().catch(e => { console.error(e); process.exit(1); });
