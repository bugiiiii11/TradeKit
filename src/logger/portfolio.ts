/**
 * Portfolio analytics
 *
 * Reads the trade log and computes:
 *   - Total PnL (USD and %)
 *   - Win rate
 *   - Average win / average loss
 *   - Max drawdown
 *   - Per-strategy breakdown
 */

import { readAll, TradeRecord } from "./trade_logger";

export interface PortfolioStats {
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnlUsd: number;
  avgWinUsd: number;
  avgLossUsd: number;
  riskRewardRatio: number;
  maxDrawdownUsd: number;
  byStrategy: Record<string, { trades: number; pnlUsd: number; winRate: number }>;
}

export function getPortfolioStats(startingBankroll: number): PortfolioStats {
  const records = readAll();
  const closed = records.filter((r) => r.pnl_usd !== null);
  const open = records.filter((r) => r.pnl_usd === null);

  const wins = closed.filter((r) => (r.pnl_usd ?? 0) > 0);
  const losses = closed.filter((r) => (r.pnl_usd ?? 0) <= 0);

  const totalPnlUsd = closed.reduce((sum, r) => sum + (r.pnl_usd ?? 0), 0);

  const avgWinUsd =
    wins.length > 0
      ? wins.reduce((s, r) => s + (r.pnl_usd ?? 0), 0) / wins.length
      : 0;

  const avgLossUsd =
    losses.length > 0
      ? Math.abs(losses.reduce((s, r) => s + (r.pnl_usd ?? 0), 0) / losses.length)
      : 0;

  const riskRewardRatio = avgLossUsd > 0 ? avgWinUsd / avgLossUsd : 0;

  // Max drawdown: largest peak-to-trough equity decline
  let peak = startingBankroll;
  let equity = startingBankroll;
  let maxDrawdownUsd = 0;
  for (const r of closed) {
    equity += r.pnl_usd ?? 0;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdownUsd) maxDrawdownUsd = dd;
  }

  // Per-strategy stats
  const byStrategy: PortfolioStats["byStrategy"] = {};
  for (const r of closed) {
    if (!byStrategy[r.strategy]) {
      byStrategy[r.strategy] = { trades: 0, pnlUsd: 0, winRate: 0 };
    }
    byStrategy[r.strategy].trades += 1;
    byStrategy[r.strategy].pnlUsd += r.pnl_usd ?? 0;
  }
  for (const key of Object.keys(byStrategy)) {
    const stratClosed = closed.filter((r) => r.strategy === key);
    const stratWins = stratClosed.filter((r) => (r.pnl_usd ?? 0) > 0);
    byStrategy[key].winRate =
      stratClosed.length > 0 ? stratWins.length / stratClosed.length : 0;
    byStrategy[key].pnlUsd = parseFloat(byStrategy[key].pnlUsd.toFixed(4));
  }

  return {
    totalTrades: records.length,
    closedTrades: closed.length,
    openTrades: open.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length > 0 ? wins.length / closed.length : 0,
    totalPnlUsd: parseFloat(totalPnlUsd.toFixed(4)),
    avgWinUsd: parseFloat(avgWinUsd.toFixed(4)),
    avgLossUsd: parseFloat(avgLossUsd.toFixed(4)),
    riskRewardRatio: parseFloat(riskRewardRatio.toFixed(2)),
    maxDrawdownUsd: parseFloat(maxDrawdownUsd.toFixed(4)),
    byStrategy,
  };
}

export function printPortfolioStats(startingBankroll: number): void {
  const stats = getPortfolioStats(startingBankroll);
  console.log("\n=== Portfolio Stats ===");
  console.log(`Total trades:    ${stats.totalTrades} (${stats.openTrades} open)`);
  console.log(`Win rate:        ${(stats.winRate * 100).toFixed(1)}% (${stats.wins}W / ${stats.losses}L)`);
  console.log(`Total PnL:       $${stats.totalPnlUsd}`);
  console.log(`Avg win:         $${stats.avgWinUsd}`);
  console.log(`Avg loss:        $${stats.avgLossUsd}`);
  console.log(`Risk/reward:     ${stats.riskRewardRatio}x`);
  console.log(`Max drawdown:    $${stats.maxDrawdownUsd}`);
  console.log("\nBy strategy:");
  for (const [k, v] of Object.entries(stats.byStrategy)) {
    console.log(`  ${k}: ${v.trades} trades, PnL $${v.pnlUsd}, WR ${(v.winRate * 100).toFixed(1)}%`);
  }
  console.log("======================\n");
}
