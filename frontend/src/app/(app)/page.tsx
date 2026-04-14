import {
  AlertCircle,
  Banknote,
  CircleDollarSign,
  Gauge,
  Layers,
  LineChart,
  OctagonX,
  ShieldAlert,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { KillSwitchButton } from "@/components/kill-switch-button";
import { ManualTradeCard } from "@/components/manual-trade-card";
import { AnimateIn } from "@/components/animate-in";
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
  formatFundingRate,
  formatPercent,
  formatPrice,
  formatRelativeTime,
  formatTime,
  formatUsd,
} from "@/lib/format";

type MarketSnapshot = {
  id: number;
  taken_at: string;
  symbol: string;
  price: number | string;
  funding_rate: number | string | null;
  timeframes: unknown;
  macro_filter: "bullish" | "bearish" | "neutral" | null;
  confluence_score: number | null;
};

type RiskSnapshot = {
  id: number;
  taken_at: string;
  bankroll_usd: number | string;
  daily_pnl: number | string | null;
  weekly_pnl: number | string | null;
  daily_dd_pct: number | string | null;
  weekly_dd_pct: number | string | null;
  consecutive_losses: number | null;
  open_position_count: number | null;
  paused_until: string | null;
  pause_reason: string | null;
  killed: boolean | null;
  kill_reason: string | null;
};

type BotLog = {
  id: number;
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  source: string | null;
  message: string;
};

type Position = {
  id: string;
  symbol: string;
  side: "long" | "short";
  size: number | string;
  entry_price: number | string;
  mark_price: number | string | null;
  unrealized_pnl: number | string | null;
  leverage: number | string | null;
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { data: marketRows },
    { data: riskRows },
    { data: logRows },
    { data: positionRows },
  ] = await Promise.all([
    supabase
      .from("market_snapshots")
      .select("*")
      .order("taken_at", { ascending: false })
      .limit(10),
    supabase
      .from("risk_snapshots")
      .select("*")
      .order("taken_at", { ascending: false })
      .limit(1),
    supabase
      .from("bot_logs")
      .select("*")
      .order("ts", { ascending: false })
      .limit(20),
    supabase.from("positions").select("*"),
  ]);

  const market = (marketRows ?? []) as MarketSnapshot[];
  const latestMarket = market[0];
  const latestRisk = ((riskRows ?? [])[0] ?? null) as RiskSnapshot | null;
  const logs = (logRows ?? []) as BotLog[];
  const positions = (positionRows ?? []) as Position[];

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Live telemetry from the BTC perpetuals bot.{" "}
            {latestMarket ? (
              <>
                Last tick{" "}
                <span className="font-medium text-foreground">
                  {formatRelativeTime(latestMarket.taken_at)}
                </span>
                .
              </>
            ) : (
              <span className="text-muted-foreground">
                Waiting for first tick…
              </span>
            )}
          </p>
        </div>
        <KillSwitchButton killed={Boolean(latestRisk?.killed)} />
      </div>

      {/* Top stats row */}
      <AnimateIn className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Bankroll"
          value={formatUsd(latestRisk?.bankroll_usd)}
          icon={<Banknote className="h-4 w-4" />}
          subline={
            latestRisk ? (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  Day:{" "}
                  <span className={pnlClass(latestRisk.daily_pnl)}>
                    {formatUsd(latestRisk.daily_pnl)}
                  </span>
                </span>
                <span>
                  Wk:{" "}
                  <span className={pnlClass(latestRisk.weekly_pnl)}>
                    {formatUsd(latestRisk.weekly_pnl)}
                  </span>
                </span>
              </div>
            ) : null
          }
        />
        <StatCard
          title="BTC Price"
          value={formatPrice(latestMarket?.price)}
          icon={<CircleDollarSign className="h-4 w-4" />}
          subline={
            latestMarket ? (
              <div className="flex items-center gap-2 text-xs">
                <MacroBadge filter={latestMarket.macro_filter} />
                <span className="text-muted-foreground">
                  Fund {formatFundingRate(latestMarket.funding_rate)}
                </span>
              </div>
            ) : null
          }
        />
        <StatCard
          title="Confluence"
          value={
            latestMarket?.confluence_score !== null &&
            latestMarket?.confluence_score !== undefined
              ? `${latestMarket.confluence_score} / 3`
              : "—"
          }
          icon={<Gauge className="h-4 w-4" />}
          subline={
            <div className="text-xs text-muted-foreground">
              Strategies aligned this tick
            </div>
          }
        />
        <StatCard
          title="Positions"
          value={`${latestRisk?.open_position_count ?? positions.length}`}
          icon={<Layers className="h-4 w-4" />}
          subline={
            <div className="text-xs text-muted-foreground">
              {latestRisk?.consecutive_losses
                ? `${latestRisk.consecutive_losses} consecutive losses`
                : "No recent losses"}
            </div>
          }
        />
      </AnimateIn>

      {/* Manual trade card — high on page for quick access */}
      <AnimateIn delay={50} className="mb-6">
        <ManualTradeCard markPrice={Number(latestMarket?.price) || 0} />
      </AnimateIn>

      {/* Kill switch banner — highest priority, sits above the pause banner */}
      {latestRisk?.killed && (
        <Card className="mb-6 border-destructive/60 bg-destructive/10">
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <OctagonX className="h-5 w-5 text-destructive" />
            <div className="flex-1">
              <CardTitle className="text-base text-destructive">
                Kill switch active
              </CardTitle>
              <CardDescription>
                {latestRisk.kill_reason
                  ? latestRisk.kill_reason
                  : "All positions closed. No new entries until you click Resume."}
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Pause / risk banner */}
      {latestRisk?.paused_until && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5">
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            <div>
              <CardTitle className="text-base">Bot paused</CardTitle>
              <CardDescription>
                Until {formatTime(latestRisk.paused_until)}
                {latestRisk.pause_reason ? ` — ${latestRisk.pause_reason}` : ""}
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Main grid */}
      <AnimateIn delay={100} className="grid gap-6 lg:grid-cols-3">
        {/* Recent ticks table */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <LineChart className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Recent Ticks</CardTitle>
            </div>
            <CardDescription>
              Last 10 market snapshots (every 15 minutes)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {market.length === 0 ? (
              <EmptyState
                icon={<LineChart className="h-5 w-5" />}
                title="No ticks yet"
                description="Start the bot in DRY_RUN mode and ticks will appear here."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Macro</TableHead>
                    <TableHead className="text-right">Confluence</TableHead>
                    <TableHead className="text-right">Funding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {market.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">
                        {formatTime(row.taken_at)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatPrice(row.price)}
                      </TableCell>
                      <TableCell>
                        <MacroBadge filter={row.macro_filter} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.confluence_score ?? 0}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {formatFundingRate(row.funding_rate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Open positions card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Open Positions</CardTitle>
            </div>
            <CardDescription>
              Live from Hyperliquid (synced every tick)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {positions.length === 0 ? (
              <EmptyState
                icon={<Layers className="h-5 w-5" />}
                title="Flat"
                description="No open positions right now."
              />
            ) : (
              <ul className="space-y-3">
                {positions.map((pos) => (
                  <li
                    key={pos.id}
                    className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          pos.side === "long" ? "default" : "destructive"
                        }
                      >
                        {pos.side.toUpperCase()}
                      </Badge>
                      <div className="text-sm font-medium">{pos.symbol}</div>
                    </div>
                    <div className="flex flex-col items-end text-xs">
                      <span className="font-mono">
                        {formatPrice(pos.entry_price)}
                      </span>
                      <span className={pnlClass(pos.unrealized_pnl)}>
                        {formatUsd(pos.unrealized_pnl)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </AnimateIn>

      {/* Log viewer */}
      <AnimateIn delay={200}>
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Bot Logs</CardTitle>
          </div>
          <CardDescription>Most recent 20 lines</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <EmptyState
              icon={<AlertCircle className="h-5 w-5" />}
              title="No logs yet"
              description="Logs will stream here once the bot is running."
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-border bg-muted/20">
              <ul className="divide-y divide-border font-mono text-xs">
                {logs.map((log) => (
                  <li
                    key={log.id}
                    className="px-3 py-1.5"
                  >
                    {/* Mobile: stacked | Desktop: single row */}
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="shrink-0">{formatTime(log.ts)}</span>
                      <LogLevel level={log.level} />
                      <span className="shrink-0">[{log.source ?? "main"}]</span>
                    </div>
                    <div className="mt-0.5 break-words text-foreground/90">
                      {log.message}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      </AnimateIn>

      {/* Footer hint */}
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Page is rendered server-side on each request. Refresh to see the latest
        tick.
        {latestRisk && (
          <>
            {" "}
            Daily drawdown {formatPercent(latestRisk.daily_dd_pct)} · Weekly{" "}
            {formatPercent(latestRisk.weekly_dd_pct)}.
          </>
        )}
      </p>
    </>
  );
}

function StatCard({
  title,
  value,
  icon,
  subline,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  subline?: React.ReactNode;
}) {
  return (
    <Card className="stat-card">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
        <div className="rounded-md bg-muted/60 p-1.5 text-muted-foreground">
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums tracking-tight">
          {value}
        </div>
        {subline && <div className="mt-1.5">{subline}</div>}
      </CardContent>
    </Card>
  );
}

function MacroBadge({
  filter,
}: {
  filter: "bullish" | "bearish" | "neutral" | null;
}) {
  if (!filter) return <Badge variant="outline">—</Badge>;
  const variant =
    filter === "bullish"
      ? "default"
      : filter === "bearish"
        ? "destructive"
        : "secondary";
  return (
    <Badge variant={variant} className="capitalize">
      {filter}
    </Badge>
  );
}

function LogLevel({ level }: { level: BotLog["level"] }) {
  const color =
    level === "error"
      ? "text-destructive"
      : level === "warn"
        ? "text-yellow-500"
        : level === "debug"
          ? "text-muted-foreground"
          : "text-primary";
  return (
    <span className={`w-10 shrink-0 uppercase ${color}`}>
      {level.slice(0, 4)}
    </span>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </div>
  );
}

function pnlClass(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "text-muted-foreground";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n) || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-green-500" : "text-destructive";
}
