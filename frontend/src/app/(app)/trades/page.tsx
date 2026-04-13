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
import { formatPrice, formatTime, formatUsd } from "@/lib/format";

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

export const dynamic = "force-dynamic";

export default async function TradesPage() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("trades")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  const trades = (rows ?? []) as Trade[];

  const botTrades = trades.filter((t) => t.source !== "manual");
  const manualTrades = trades.filter((t) => t.source === "manual");
  const botStats = computeStats(botTrades);
  const manualStats = computeStats(manualTrades);
  const allStats = computeStats(trades);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Trades</h1>
        <p className="text-sm text-muted-foreground">
          Closed trades from the bot and manual test trades, tracked separately.
        </p>
      </div>

      {/* ----- Combined stats ----- */}
      <AnimateIn className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          title="Total PnL"
          value={formatUsd(allStats.totalPnlUsd)}
          icon={<Banknote className="h-4 w-4" />}
          tone={pnlTone(allStats.totalPnlUsd)}
          hint={`${allStats.count} closed`}
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
              title="No bot trades yet"
              description={
                <>
                  The bot hasn&apos;t closed a trade yet. On the first LIVE
                  close, one row will be written here with entry/exit prices,
                  PnL, and the confluence conditions that triggered the entry.
                </>
              }
            />
          ) : (
            <TradeTable trades={botTrades} showLeverage />
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
            Test trades placed via the custom trade script.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {manualTrades.length === 0 ? (
            <EmptyState
              icon={<Receipt className="h-5 w-5" />}
              title="No manual trades yet"
              description="Run test_custom_trade.ts to place a manual trade. Results will appear here."
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

type Stats = {
  count: number;
  wins: number;
  losses: number;
  totalPnlUsd: number;
  avgR: number;
  best: number | null;
  worst: number | null;
};

function computeStats(trades: Trade[]): Stats {
  const closed = trades.filter(
    (t) => t.pnl_usd !== null && t.pnl_usd !== undefined,
  );
  if (closed.length === 0) {
    return {
      count: 0,
      wins: 0,
      losses: 0,
      totalPnlUsd: 0,
      avgR: 0,
      best: null,
      worst: null,
    };
  }

  let total = 0;
  let wins = 0;
  let losses = 0;
  let best = -Infinity;
  let worst = Infinity;
  let rSum = 0;
  let rCount = 0;

  for (const t of closed) {
    const pnl = Number(t.pnl_usd);
    if (!Number.isFinite(pnl)) continue;
    total += pnl;
    if (pnl > 0) wins += 1;
    else if (pnl < 0) losses += 1;
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
    best: best === -Infinity ? null : best,
    worst: worst === Infinity ? null : worst,
  };
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

function TradeTable({ trades, showLeverage }: { trades: Trade[]; showLeverage?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Closed</TableHead>
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
            return (
              <TableRow key={t.id}>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {t.exit_time
                    ? formatTime(t.exit_time)
                    : formatTime(t.created_at)}
                </TableCell>
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
