import { BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { BacktestTabs, type BacktestRun } from "@/components/backtest-tabs";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Date the multi-TF lookahead was fixed (commit 71d3422). Every stored run
 * generated before this used an aligner that handed the engine the
 * still-forming higher-TF bar -- up to 45min/3h45m/23h45m of future data on
 * 1H/4H/1D -- so its PF, win rate and PnL are not achievable.
 */
const LOOKAHEAD_FIX_AT = "2026-09-18";

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
  const inflated = runs.filter(r => r.generatedAt < LOOKAHEAD_FIX_AT).length;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Backtests</h1>
        <p className="text-sm text-muted-foreground">
          Historical strategy replay on Hyperliquid candle data. Each tab is one run.
        </p>
      </div>

      {inflated > 0 && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">
            {inflated === runs.length ? "These runs are" : `${inflated} of these runs are`}{" "}
            inflated by lookahead — do not read them as a forecast.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Anything generated before {LOOKAHEAD_FIX_AT} was replayed against the
            still-forming 1H/4H/1D bar, i.e. up to 45min / 3h45m / 23h45m of future
            data on every bar. Corrected out-of-sample numbers for the live set:
            PF 1.03, not 1.99. See{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              docs/polish/s52-corrected-matrix.md
            </code>
            .
          </p>
        </div>
      )}

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
