import Link from "next/link";
import {
  Banknote,
  History,
  Percent,
  Receipt,
  Target,
  TrendingUp,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
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
import { AnimateIn } from "@/components/animate-in";
import { formatDateTime, formatPrice, formatUsd } from "@/lib/format";

type Trade = {
  id: string;
  strategy_config_id: string | null;
  symbol: string;
  side: "long" | "short";
  size: number | string;
  entry_price: number | string | null;
  exit_price: number | string | null;
  entry_time: string | null;
  exit_time: string | null;
  pnl_usd: number | string | null;
  pnl_r: number | string | null;
  fees_usd: number | string | null;
  slippage_bps: number | string | null;
  exit_reason: string | null;
  entry_conditions: Record<string, unknown> | null;
  source: "bot" | "manual" | null;
  created_at: string;
};

/**
 * Start of the current strategy configuration (S1 + S6, S2/S3 disabled).
 * The first S6 bot trade opened 2026-06-01 (Session 43). Everything before it
 * belongs to the S3 scalp / S2 eras that were disabled after their backtests
 * went negative, so the default stats window starts here.
 */
const CURRENT_CONFIG_SINCE = "2026-06-01";

/**
 * Backtest reference numbers per strategy, shown beside the live figures so a
 * divergence is visible without opening the archive.
 *
 * Source: docs/polish/s52-corrected-matrix.md -- the OUT-OF-SAMPLE window
 * (2025-07-01 -> 2026-09-17, 444d), which is the only honest comparison for
 * live results and overlaps the live trading period.
 *
 * These replace the Session 29-31 figures (S1 78% WR, S6 46% WR, +$87/+$76).
 * Those were produced before commit 71d3422, when the backtest aligner fed the
 * engine the still-forming higher-TF bar -- up to 45min/3h45m/23h45m of future
 * data on 1H/4H/1D. Every number it ever produced was inflated, so the
 * scoreboard was flagging live S6 as underperforming a reference that never
 * existed. Do not restore them.
 *
 * `thin` marks a reference with too few trades to judge anything against; the
 * lagging highlight is suppressed for those.
 */
const BACKTEST_REF: Record<
  string,
  { winRate: number; trades: number; pf: number; note: string; thin?: boolean }
> = {
  S1: { winRate: 31, trades: 13, pf: 1.3, note: "+$13 / 444d OOS", thin: true },
  S6: { winRate: 39, trades: 198, pf: 1.01, note: "+$3 / 444d OOS" },
  S2: { winRate: 44, trades: 71, pf: 1.13, note: "+$11 / 444d OOS, disabled" },
  S3: { winRate: 29, trades: 839, pf: 0.48, note: "-$90 / 444d OOS, disabled" },
};

export const dynamic = "force-dynamic";

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{ since?: string }>;
}) {
  const { since: sinceParam } = await searchParams;
  const allTime = sinceParam === "all";
  const since = allTime ? null : isIsoDate(sinceParam) ? sinceParam : CURRENT_CONFIG_SINCE;

  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("trades")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1000);

  const everything = (rows ?? []) as Trade[];
  const trades = since
    ? everything.filter((t) => closedAt(t) >= since)
    : everything;

  const botTrades = trades.filter((t) => t.source !== "manual");
  const manualTrades = trades.filter((t) => t.source === "manual");
  const botStats = computeStats(botTrades);
  const manualStats = computeStats(manualTrades);
  const allStats = computeStats(trades);
  const byStrategy = groupByStrategy(botTrades);
  const hiddenCount = everything.length - trades.length;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trades</h1>
          <p className="text-sm text-muted-foreground">
            Closed trades from the bot and manual test trades, tracked separately.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5 text-xs">
          <FilterLink href="/trades" active={!allTime}>
            Since current config ({CURRENT_CONFIG_SINCE})
          </FilterLink>
          <FilterLink href="/trades?since=all" active={allTime}>
            All time
          </FilterLink>
        </div>
      </div>

      {/* ----- Combined stats ----- */}
      <AnimateIn className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          title="Total PnL"
          value={formatUsd(allStats.totalPnlUsd)}
          icon={<Banknote className="h-4 w-4" />}
          tone={pnlTone(allStats.totalPnlUsd)}
          hint={
            hiddenCount > 0
              ? `${allStats.count} closed · ${hiddenCount} older hidden`
              : `${allStats.count} closed`
          }
        />
        <StatCard
          title="Win Rate"
          value={
            allStats.count
              ? `${Math.round((allStats.wins / allStats.count) * 100)}%`
              : "—"
          }
          icon={<Percent className="h-4 w-4" />}
          hint={`${allStats.wins}W / ${allStats.losses}L`}
        />
        <StatCard
          title="Avg R"
          value={allStats.count ? allStats.avgR.toFixed(2) : "—"}
          icon={<Target className="h-4 w-4" />}
          hint="R = PnL / risk"
        />
        <StatCard
          title="Best Trade"
          value={allStats.best !== null ? formatUsd(allStats.best) : "—"}
          icon={<TrendingUp className="h-4 w-4" />}
          hint={
            allStats.worst !== null ? `Worst ${formatUsd(allStats.worst)}` : "—"
          }
        />
      </AnimateIn>

      {/* ----- Per-strategy scoreboard (live vs backtest) ----- */}
      <AnimateIn delay={50} className="mb-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Strategy Scoreboard</CardTitle>
          </div>
          <CardDescription>
            Live bot results per strategy
            {since ? ` since ${since}` : " (all time)"}, with the backtest
            reference beside each. References are out-of-sample (444d) on the
            corrected alignment — every pre-S52 backtest number was inflated by
            lookahead. A live win rate well under its reference after 20+ trades
            is the signal to act; references marked thin are too small to judge
            against.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {byStrategy.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No closed bot trades in this window.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Strategy</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">W / L</TableHead>
                    <TableHead className="text-right">Win Rate</TableHead>
                    <TableHead className="text-right">PnL</TableHead>
                    <TableHead className="text-right">Avg R</TableHead>
                    <TableHead className="text-right">Expectancy</TableHead>
                    <TableHead className="text-right">Profit Factor</TableHead>
                    <TableHead className="text-right">Max Consec. L</TableHead>
                    <TableHead>Backtest ref</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byStrategy.map(({ strategy, stats }) => {
                    const ref = BACKTEST_REF[strategy];
                    const liveWr = stats.count
                      ? Math.round((stats.wins / stats.count) * 100)
                      : null;
                    // A thin reference (S1: 13 trades in 444 days) cannot tell
                    // you anything about a live win rate, so never flag against it.
                    const lagging =
                      ref &&
                      !ref.thin &&
                      liveWr !== null &&
                      stats.count >= 10 &&
                      liveWr < ref.winRate - 10;
                    return (
                      <TableRow key={strategy}>
                        <TableCell>
                          <StrategyBadge strategy={strategy} />
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {stats.count}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {stats.wins} / {stats.losses}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono text-xs ${lagging ? "text-destructive" : ""}`}
                        >
                          {liveWr !== null ? `${liveWr}%` : "—"}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono text-xs ${pnlClass(stats.totalPnlUsd)}`}
                        >
                          {formatUsd(stats.totalPnlUsd)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono text-xs ${pnlClass(stats.avgR)}`}
                        >
                          {stats.avgR.toFixed(2)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono text-xs ${pnlClass(stats.expectancy)}`}
                        >
                          {formatUsd(stats.expectancy)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {stats.profitFactor === null
                            ? "—"
                            : stats.profitFactor === Infinity
                              ? "∞"
                              : stats.profitFactor.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {stats.maxConsecLosses}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {ref
                            ? `${ref.winRate}% WR · ${ref.trades} trades${ref.pf ? ` · PF ${ref.pf}` : ""} · ${ref.note}${ref.thin ? " · thin" : ""}`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      </AnimateIn>

      {/* ----- Bot trades ----- */}
      <AnimateIn delay={100} className="mb-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Bot Trades</CardTitle>
            {botStats.count > 0 && (
              <Badge variant="secondary" className="ml-auto font-mono text-xs">
                PnL {formatUsd(botStats.totalPnlUsd)} &middot; {botStats.wins}W / {botStats.losses}L
              </Badge>
            )}
          </div>
          <CardDescription>
            Strategy-driven trades from the automated bot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {botTrades.length === 0 ? (
            <EmptyState
              icon={<Receipt className="h-5 w-5" />}
              title="No bot trades in this window"
              description={
                <>
                  The bot hasn&apos;t closed a trade since {since ?? "the beginning"}.
                  Switch to &ldquo;All time&rdquo; to see earlier eras.
                </>
              }
            />
          ) : (
            <TradeTable trades={botTrades} showLeverage showStrategy />
          )}
        </CardContent>
      </Card>
      </AnimateIn>

      {/* ----- Manual trades ----- */}
      <AnimateIn delay={200}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Manual Trades</CardTitle>
            {manualStats.count > 0 && (
              <Badge variant="secondary" className="ml-auto font-mono text-xs">
                PnL {formatUsd(manualStats.totalPnlUsd)} &middot; {manualStats.wins}W / {manualStats.losses}L
              </Badge>
            )}
          </div>
          <CardDescription>
            Test trades placed via the custom trade script or the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {manualTrades.length === 0 ? (
            <EmptyState
              icon={<Receipt className="h-5 w-5" />}
              title="No manual trades in this window"
              description="Place a manual trade from the dashboard or test_custom_trade.ts. Results will appear here."
            />
          ) : (
            <TradeTable trades={manualTrades} showLeverage />
          )}
        </CardContent>
      </Card>
      </AnimateIn>
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isIsoDate(v: string | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function closedAt(t: Trade): string {
  return t.exit_time ?? t.created_at;
}

function strategyOf(t: Trade): string {
  if (t.source === "manual") return "manual";
  const s = t.entry_conditions?.strategy;
  return typeof s === "string" && s.length > 0 ? s.toUpperCase() : "unknown";
}

type Stats = {
  count: number;
  wins: number;
  losses: number;
  totalPnlUsd: number;
  avgR: number;
  expectancy: number;
  profitFactor: number | null;
  maxConsecLosses: number;
  best: number | null;
  worst: number | null;
};

const EMPTY_STATS: Stats = {
  count: 0,
  wins: 0,
  losses: 0,
  totalPnlUsd: 0,
  avgR: 0,
  expectancy: 0,
  profitFactor: null,
  maxConsecLosses: 0,
  best: null,
  worst: null,
};

function computeStats(trades: Trade[]): Stats {
  const closed = trades.filter(
    (t) => t.pnl_usd !== null && t.pnl_usd !== undefined,
  );
  if (closed.length === 0) return EMPTY_STATS;

  let total = 0;
  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let best = -Infinity;
  let worst = Infinity;
  let rSum = 0;
  let rCount = 0;
  let streak = 0;
  let maxStreak = 0;

  // Rows arrive newest first; walk oldest -> newest for the loss streak.
  const chronological = [...closed].sort((a, b) =>
    closedAt(a).localeCompare(closedAt(b)),
  );

  for (const t of chronological) {
    const pnl = Number(t.pnl_usd);
    if (!Number.isFinite(pnl)) continue;
    total += pnl;
    if (pnl > 0) {
      wins += 1;
      grossWin += pnl;
      streak = 0;
    } else if (pnl < 0) {
      losses += 1;
      grossLoss += -pnl;
      streak += 1;
      if (streak > maxStreak) maxStreak = streak;
    }
    if (pnl > best) best = pnl;
    if (pnl < worst) worst = pnl;

    if (t.pnl_r !== null && t.pnl_r !== undefined) {
      const r = Number(t.pnl_r);
      if (Number.isFinite(r)) {
        rSum += r;
        rCount += 1;
      }
    }
  }

  return {
    count: closed.length,
    wins,
    losses,
    totalPnlUsd: total,
    avgR: rCount > 0 ? rSum / rCount : 0,
    expectancy: total / closed.length,
    profitFactor:
      grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    maxConsecLosses: maxStreak,
    best: best === -Infinity ? null : best,
    worst: worst === Infinity ? null : worst,
  };
}

function groupByStrategy(
  trades: Trade[],
): Array<{ strategy: string; stats: Stats }> {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = strategyOf(t);
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([strategy, list]) => ({ strategy, stats: computeStats(list) }))
    .sort((a, b) => a.strategy.localeCompare(b.strategy));
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded px-2 py-1 ${
        active
          ? "bg-primary/15 font-medium text-primary"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

function StrategyBadge({ strategy }: { strategy: string }) {
  const live = strategy === "S1" || strategy === "S6";
  return (
    <Badge
      variant={live ? "default" : "outline"}
      className="font-mono text-[10px]"
      title={live ? "Enabled on the VPS bot" : "Not in the current config"}
    >
      {strategy}
    </Badge>
  );
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
    tone === "positive"
      ? "text-green-500"
      : tone === "negative"
        ? "text-destructive"
        : "";
  return (
    <Card className="stat-card">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
        <div className="rounded-md bg-muted/60 p-1.5 text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold tabular-nums tracking-tight ${valueClass}`}>
          {value}
        </div>
        {hint && (
          <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
        )}
      </CardContent>
    </Card>
  );
}

function TradeTable({
  trades,
  showLeverage,
  showStrategy,
}: {
  trades: Trade[];
  showLeverage?: boolean;
  showStrategy?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Closed</TableHead>
            {showStrategy && <TableHead>Strategy</TableHead>}
            <TableHead>Symbol</TableHead>
            <TableHead>Side</TableHead>
            {showLeverage && <TableHead className="text-right">Lev</TableHead>}
            <TableHead className="text-right">Size</TableHead>
            <TableHead className="text-right">Entry</TableHead>
            <TableHead className="text-right">Exit</TableHead>
            <TableHead className="text-right">PnL</TableHead>
            <TableHead className="text-right">R</TableHead>
            <TableHead>Exit Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((t) => {
            const leverage = t.entry_conditions?.leverage;
            const closedIso = closedAt(t);
            return (
              <TableRow key={t.id}>
                <TableCell
                  className="whitespace-nowrap font-mono text-xs"
                  title={closedIso}
                >
                  {formatDateTime(closedIso)}
                </TableCell>
                {showStrategy && (
                  <TableCell>
                    <StrategyBadge strategy={strategyOf(t)} />
                  </TableCell>
                )}
                <TableCell className="font-medium">{t.symbol}</TableCell>
                <TableCell>
                  <Badge
                    variant={t.side === "long" ? "default" : "destructive"}
                    className="uppercase"
                  >
                    {t.side}
                  </Badge>
                </TableCell>
                {showLeverage && (
                  <TableCell className="text-right font-mono text-xs">
                    {leverage ? `${leverage}x` : "—"}
                  </TableCell>
                )}
                <TableCell className="text-right font-mono text-xs">
                  {formatNumber(t.size, 5)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatPrice(t.entry_price)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatPrice(t.exit_price)}
                </TableCell>
                <TableCell
                  className={`text-right font-mono text-xs ${pnlClass(t.pnl_usd)}`}
                >
                  {formatUsd(t.pnl_usd)}
                </TableCell>
                <TableCell
                  className={`text-right font-mono text-xs ${pnlClass(t.pnl_r)}`}
                >
                  {t.pnl_r !== null && t.pnl_r !== undefined
                    ? Number(t.pnl_r).toFixed(2)
                    : "—"}
                </TableCell>
                <TableCell className="max-w-50 truncate text-xs text-muted-foreground">
                  {t.exit_reason ?? "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function formatNumber(
  value: number | string | null | undefined,
  digits = 2,
): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function pnlClass(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "text-muted-foreground";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n) || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-green-500" : "text-destructive";
}

function pnlTone(value: number): "positive" | "negative" | "default" {
  if (!Number.isFinite(value) || value === 0) return "default";
  return value > 0 ? "positive" : "negative";
}
