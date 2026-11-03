/**
 * Throwaway (Landscape v1, seat B). Replays S1+S6 (and S6-only, S1-only) on a --from/--to window
 * using the repo's own loader/aligner/engine and prints the trade list. Does NOT persist anywhere.
 * Usage: npx ts-node docs/collab/landscape-v1/scripts/B/bt_window.ts --data-dir <dir> --from 2026-08-20 --to 2026-11-01 --bankroll 365
 */
import * as path from "path";
import { loadBinanceData } from "../../../../../src/backtest/binance-loader";
import { alignBars } from "../../../../../src/backtest/aligner";
import { runBacktest } from "../../../../../src/backtest/engine";
import type { StrategyId } from "../../../../../src/backtest/types";
function flag(n: string, d: string) { const i = process.argv.indexOf(`--${n}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; }
(async () => {
  const dataDir = flag("data-dir", path.resolve(process.cwd(), "data/bt-data"));
  const fromMs = Date.parse(`${flag("from", "2026-08-20")}T00:00:00Z`), toMs = Date.parse(`${flag("to", "2026-11-01")}T00:00:00Z`);
  const bankroll = parseFloat(flag("bankroll", "365"));
  const col = await loadBinanceData(dataDir, 700, { pmarpPeriod: 20, pmarpLookback: 350 });
  const aligned = alignBars(col.bars15m, col.bars1H, col.bars4H, col.bars1D, col.backtestStartMs);
  const replay = aligned.filter(a => a.bar15m.timestamp >= fromMs && a.bar15m.timestamp < toMs);
  const days = Math.round((replay[replay.length - 1].bar15m.timestamp - replay[0].bar15m.timestamp) / 86400000);
  for (const set of [["S1", "S6"], ["S6"], ["S1"]] as StrategyId[][]) {
    const r = runBacktest(replay, { days, bankroll, marginPct: 0.05, enabledStrategies: set });
    const s = r.stats;
    console.log(`\n=== ${set.join("+")} ${flag("from", "")}..${flag("to", "")} (${days}d) bankroll $${bankroll}: n=${s.totalTrades} WR=${(s.winRate * 100).toFixed(1)}% PnL=$${s.totalPnlUsd.toFixed(2)} PF=${s.profitFactor.toFixed(2)} DD=${s.maxDrawdownPct.toFixed(1)}% avgW=$${s.avgWinUsd?.toFixed(2)} avgL=$${s.avgLossUsd?.toFixed(2)}`);
    for (const t of r.trades) {
      const a = t as any; const ms = (v: any) => typeof v === "number" ? new Date(v).toISOString().slice(0, 16) : String(v).slice(0, 16);
      console.log(`${ms(a.entryTime ?? a.entryTimestamp ?? a.entryTs)} ${ms(a.exitTime ?? a.exitTimestamp ?? a.exitTs)} ${a.strategy} ${a.direction} e=${a.entryPrice} x=${a.exitPrice} pnl=${Number(a.pnlUsd).toFixed(2)} fees=${a.feesUsd?.toFixed?.(3)} fund=${a.fundingPnl?.toFixed?.(3)} ${a.exitReason}`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
