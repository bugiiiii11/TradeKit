"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Percent,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { formatPrice, formatUsd } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types (must match reporter output)
// ---------------------------------------------------------------------------

export type BacktestRun = {
  label: string;      // e.g. "365d · Apr 14"
  filename: string;
  config: { days: number; bankroll: number; marginPct: number };
  generatedAt: string;
  stats: {
    totalTrades: number;
    winners: number;
    losers: number;
    winRate: number;
    totalPnlUsd: number;
    maxDrawdownUsd: number;
    maxDrawdownPct: number;
    profitFactor: number;
    avgWinUsd: number;
    avgLossUsd: number;
    avgRMultiple: number;
    sharpeRatio: number;
    byStrategy: Record<string, { trades: number; winRate: number; pnlUsd: number }>;
  };
  trades: {
    strategy: string;
    direction: "long" | "short";
    entryDate: string;
    exitDate: string;
    entryPrice: number;
    exitPrice: number;
    leverage: number;
    marginUsd: number;
    notionalUsd: number;
    pnlUsd: number;
    pnlPct: number;
    pnlR: number;
    exitReason: string;
    duration: string;
  }[];
};

// ---------------------------------------------------------------------------
// Main tabbed component
// ---------------------------------------------------------------------------

export function BacktestTabs({ runs }: { runs: BacktestRun[] }) {
  const [active, setActive] = useState(0);
  const run = runs[active];

  return (
    <div>
      {/* Tab bar */}
      <div className="mb-6 flex flex-wrap gap-2 border-b border-border pb-3">
        {runs.map((r, i) => (
          <button
            key={r.filename}
            onClick={() => setActive(i)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              i === active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Config badges */}
      <div className="mb-5 flex flex-wrap gap-2">
        <Badge variant="secondary" className="font-mono text-xs">
          {run.config.days}d window
        </Badge>
        <Badge variant="secondary" className="font-mono text-xs">
          ${run.config.bankroll} bankroll
        </Badge>
        <Badge variant="secondary" className="font-mono text-xs">
          {(run.config.marginPct * 100).toFixed(0)}% margin/trade
        </Badge>
        <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
          Generated {formatDate(run.generatedAt)}
        </Badge>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          title="Total Trades"
          value={String(run.stats.totalTrades)}
          icon={<Activity className="h-4 w-4" />}
          hint={`${run.stats.winners}W / ${run.stats.losers}L`}
        />
        <StatCard
          title="Win Rate"
          value={`${(run.stats.winRate * 100).toFixed(1)}%`}
          icon={<Percent className="h-4 w-4" />}
          hint="all strategies"
          tone={run.stats.winRate >= 0.5 ? "positive" : run.stats.winRate < 0.35 ? "negative" : "default"}
        />
        <StatCard
          title="Total PnL"
          value={formatUsd(run.stats.totalPnlUsd)}
          icon={run.stats.totalPnlUsd >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          hint={`${run.stats.totalPnlUsd >= 0 ? "+" : ""}${((run.stats.totalPnlUsd / run.config.bankroll) * 100).toFixed(1)}% bankroll`}
          tone={run.stats.totalPnlUsd > 0 ? "positive" : run.stats.totalPnlUsd < 0 ? "negative" : "default"}
        />
        <StatCard
          title="Max Drawdown"
          value={formatUsd(-Math.abs(run.stats.maxDrawdownUsd))}
          icon={<AlertTriangle className="h-4 w-4" />}
          hint={`${run.stats.maxDrawdownPct.toFixed(1)}% of bankroll`}
          tone="negative"
        />
        <StatCard
          title="Profit Factor"
          value={run.stats.profitFactor === Infinity ? "∞" : run.stats.profitFactor.toFixed(2)}
          icon={<BarChart3 className="h-4 w-4" />}
          hint="gross win / gross loss"
          tone={run.stats.profitFactor >= 1.5 ? "positive" : run.stats.profitFactor < 1 ? "negative" : "default"}
        />
        <StatCard
          title="Sharpe (ann.)"
          value={run.stats.sharpeRatio.toFixed(2)}
          icon={<TrendingUp className="h-4 w-4" />}
          hint="annualised"
          tone={run.stats.sharpeRatio >= 1 ? "positive" : run.stats.sharpeRatio < 0 ? "negative" : "default"}
        />
      </div>

      {/* Strategy breakdown */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Strategy Breakdown</CardTitle>
          </div>
          <CardDescription>Per-strategy performance over the backtest window.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Strategy</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Win %</TableHead>
                  <TableHead className="text-right">PnL ($)</TableHead>
                  <TableHead className="text-right">PnL (% bank)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(["S1", "S2", "S3"] as const).map((s) => {
                  const row = run.stats.byStrategy[s];
                  if (!row) return null;
                  const pnlBankPct = (row.pnlUsd / run.config.bankroll) * 100;
                  const label = { S1: "S1 EMA Trend", S2: "S2 Mean Rev", S3: "S3 Stoch RSI" }[s];
                  return (
                    <TableRow key={s}>
                      <TableCell className="font-medium">{label}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{row.trades}</TableCell>
                      <TableCell className={cn("text-right font-mono text-sm", row.winRate >= 0.5 ? "text-green-500" : "text-muted-foreground")}>
                        {(row.winRate * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell className={cn("text-right font-mono text-sm", pnlClass(row.pnlUsd))}>
                        {row.pnlUsd >= 0 ? "+" : ""}{formatUsd(row.pnlUsd)}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono text-sm", pnlClass(pnlBankPct))}>
                        {pnlBankPct >= 0 ? "+" : ""}{pnlBankPct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="border-t-2 font-semibold">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right font-mono text-sm">{run.stats.totalTrades}</TableCell>
                  <TableCell className={cn("text-right font-mono text-sm", run.stats.winRate >= 0.5 ? "text-green-500" : "text-muted-foreground")}>
                    {(run.stats.winRate * 100).toFixed(0)}%
                  </TableCell>
                  <TableCell className={cn("text-right font-mono text-sm", pnlClass(run.stats.totalPnlUsd))}>
                    {run.stats.totalPnlUsd >= 0 ? "+" : ""}{formatUsd(run.stats.totalPnlUsd)}
                  </TableCell>
                  <TableCell className={cn("text-right font-mono text-sm", pnlClass(run.stats.totalPnlUsd))}>
                    {run.stats.totalPnlUsd >= 0 ? "+" : ""}{((run.stats.totalPnlUsd / run.config.bankroll) * 100).toFixed(1)}%
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t pt-4 text-xs text-muted-foreground">
            <span>Avg win <span className="font-mono text-green-500">{formatUsd(run.stats.avgWinUsd)}</span></span>
            <span>Avg loss <span className="font-mono text-destructive">-{formatUsd(run.stats.avgLossUsd)}</span></span>
            <span>Avg R <span className={cn("font-mono", run.stats.avgRMultiple >= 0 ? "text-green-500" : "text-destructive")}>{run.stats.avgRMultiple.toFixed(2)}R</span></span>
          </div>
        </CardContent>
      </Card>

      {/* Trade log */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Trade Log</CardTitle>
            <Badge variant="secondary" className="ml-auto font-mono text-xs">
              {run.trades.length} trades
            </Badge>
          </div>
          <CardDescription>All simulated trades, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entry</TableHead>
                  <TableHead>Strat</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Lev</TableHead>
                  <TableHead className="text-right">Entry $</TableHead>
                  <TableHead className="text-right">Exit $</TableHead>
                  <TableHead className="text-right">PnL</TableHead>
                  <TableHead className="text-right">R</TableHead>
                  <TableHead>Dur</TableHead>
                  <TableHead>Exit Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...run.trades]
                  .sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime())
                  .map((t, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {formatEntryDate(t.entryDate)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">{t.strategy}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={t.direction === "long" ? "default" : "destructive"} className="uppercase">
                          {t.direction}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{t.leverage}x</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatPrice(t.entryPrice)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatPrice(t.exitPrice)}</TableCell>
                      <TableCell className={cn("text-right font-mono text-xs", pnlClass(t.pnlUsd))}>
                        {t.pnlUsd >= 0 ? "+" : ""}{formatUsd(t.pnlUsd)}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono text-xs", pnlClass(t.pnlR))}>
                        {t.pnlR >= 0 ? "+" : ""}{t.pnlR.toFixed(2)}R
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {t.duration}
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                        {t.exitReason}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 space-y-1 border-t pt-4 text-xs text-muted-foreground">
            <p>• SL/TP hits detected using bar high/low (not tick data)</p>
            <p>• S3 TPs: full exit at highest TP level reached in bar (real bot does 33/33/34% partial closes)</p>
            <p>• Fee: 0.035% taker × 2 sides per trade · Confluence macro filter applied</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatEntryDate(iso: string): string {
  const d = new Date(iso);
  const mm  = String(d.getMonth() + 1).padStart(2, "0");
  const dd  = String(d.getDate()).padStart(2, "0");
  const hh  = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd} ${hh}:${min}`;
}

function pnlClass(value: number): string {
  if (value === 0) return "text-muted-foreground";
  return value > 0 ? "text-green-500" : "text-destructive";
}

function StatCard({
  title,
  value,
  icon,
  hint,
  tone = "default",
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  hint?: string;
  tone?: "default" | "positive" | "negative";
}) {
  const valueClass =
    tone === "positive" ? "text-green-500" : tone === "negative" ? "text-destructive" : "";
  return (
    <Card className="stat-card">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
        <div className="rounded-md bg-muted/60 p-1.5 text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold tabular-nums tracking-tight", valueClass)}>
          {value}
        </div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
