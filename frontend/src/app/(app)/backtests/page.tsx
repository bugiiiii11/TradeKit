import { BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { BacktestTabs, type BacktestRun } from "@/components/backtest-tabs";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Load runs from Supabase backtest_runs table
// ---------------------------------------------------------------------------

async function loadRuns(): Promise<BacktestRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("backtest_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error || !data) return [];

  return data.map((row: Record<string, unknown>) => {
    const days = Number(row.days) || 0;
    const createdAt = row.created_at as string;
    const at = new Date(createdAt);
    const datePart = at.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    // Map DB row → BacktestRun shape expected by BacktestTabs
    return {
      label: `${days}d · ${datePart}`,
      filename: `${row.id}`,
      config: {
        days,
        bankroll: Number(row.bankroll) || 500,
        marginPct: Number(row.margin_pct) || 0.05,
      },
      generatedAt: createdAt,
      stats: {
        totalTrades:    Number(row.total_trades) || 0,
        winners:        Number(row.winners) || 0,
        losers:         Number(row.losers) || 0,
        winRate:        Number(row.win_rate) || 0,
        totalPnlUsd:    Number(row.total_pnl_usd) || 0,
        maxDrawdownUsd: Number(row.max_dd_usd) || 0,
        maxDrawdownPct: Number(row.max_dd_pct) || 0,
        profitFactor:   Number(row.profit_factor) || 0,
        avgWinUsd:      Number(row.avg_win_usd) || 0,
        avgLossUsd:     Number(row.avg_loss_usd) || 0,
        avgRMultiple:   Number(row.avg_r_multiple) || 0,
        sharpeRatio:    row.sharpe_ratio != null ? Number(row.sharpe_ratio) : 0,
        byStrategy: {
          S1: { trades: Number(row.s1_trades) || 0, winRate: Number(row.s1_win_rate) || 0, pnlUsd: Number(row.s1_pnl_usd) || 0 },
          S2: { trades: Number(row.s2_trades) || 0, winRate: Number(row.s2_win_rate) || 0, pnlUsd: Number(row.s2_pnl_usd) || 0 },
          S3: { trades: Number(row.s3_trades) || 0, winRate: Number(row.s3_win_rate) || 0, pnlUsd: Number(row.s3_pnl_usd) || 0 },
        },
      },
      trades: Array.isArray(row.trades) ? row.trades : [],
    } satisfies BacktestRun;
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function BacktestsPage() {
  const runs = await loadRuns();

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Backtests</h1>
        <p className="text-sm text-muted-foreground">
          Historical strategy replay on Hyperliquid candle data. Each tab is one run.
        </p>
      </div>

      {runs.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={<BarChart3 className="h-5 w-5" />}
              title="No backtest results yet"
              description={
                <>
                  Run{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    npx ts-node src/scripts/backtest.ts
                  </code>{" "}
                  to generate results. They are saved to Supabase and appear here automatically.
                </>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <BacktestTabs runs={runs} />
      )}
    </>
  );
}
