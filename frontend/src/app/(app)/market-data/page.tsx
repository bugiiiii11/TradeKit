import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Globe,
  Minus,
  TrendingDown,
  TrendingUp,
  Gauge,
  Flame,
  Snowflake,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
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
import { formatPrice, formatRelativeTime, formatFundingRate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CoinMarket = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  price_change_percentage_1h_in_currency: number | null;
  price_change_percentage_24h_in_currency: number | null;
  price_change_percentage_7d_in_currency: number | null;
};

type GlobalData = {
  data: {
    total_market_cap: { usd: number };
    market_cap_percentage: { btc: number; eth: number };
    market_cap_change_percentage_24h_usd: number;
  };
};

type FearGreed = {
  data: Array<{ value: string; value_classification: string; timestamp: string }>;
};

type IndicatorSnapshot = {
  timeframe: string;
  close: number;
  ema8: number;
  ema13: number;
  ema21: number;
  ema55: number;
  ema200: number;
  rsi14: number;
  stochK: number;
  stochD: number;
  bbwp: number;
  pmarp: number;
};

type MarketSnapshot = {
  taken_at: string;
  price: number | string;
  funding_rate: number | string | null;
  macro_filter: "bullish" | "bearish" | "neutral" | null;
  timeframes: Record<string, IndicatorSnapshot>;
};

// ---------------------------------------------------------------------------
// Data fetching (all cached 60s at the edge)
// ---------------------------------------------------------------------------

const REVALIDATE = { next: { revalidate: 60 } } as RequestInit;

async function fetchCoinPrices(): Promise<CoinMarket[]> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana,binancecoin&order=market_cap_desc&price_change_percentage=1h,24h,7d",
      REVALIDATE,
    );
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchGlobalData(): Promise<GlobalData | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/global",
      REVALIDATE,
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchFearGreed(): Promise<{ value: number; label: string } | null> {
  try {
    const res = await fetch(
      "https://api.alternative.me/fng/?limit=1",
      REVALIDATE,
    );
    if (!res.ok) return null;
    const data: FearGreed = await res.json();
    const entry = data.data?.[0];
    if (!entry) return null;
    return { value: Number(entry.value), label: entry.value_classification };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function MarketDataPage() {
  const supabase = await createClient();

  const [coins, globalData, fearGreed, { data: snapshotRows }] =
    await Promise.all([
      fetchCoinPrices(),
      fetchGlobalData(),
      fetchFearGreed(),
      supabase
        .from("market_snapshots")
        .select("*")
        .order("taken_at", { ascending: false })
        .limit(1),
    ]);

  const snapshot = ((snapshotRows ?? [])[0] ?? null) as MarketSnapshot | null;
  const tf = snapshot?.timeframes ?? {};
  const snap15m = tf["15m"] ?? null;
  const snap1H = tf["1H"] ?? null;
  const snap4H = tf["4H"] ?? null;
  const snap1D = tf["1D"] ?? null;

  const global = globalData?.data ?? null;
  const totalMcap = global?.total_market_cap?.usd ?? null;
  const btcDom = global?.market_cap_percentage?.btc ?? null;
  const ethDom = global?.market_cap_percentage?.eth ?? null;
  const mcapChange24h = global?.market_cap_change_percentage_24h_usd ?? null;

  const fundingRate =
    snapshot?.funding_rate != null ? Number(snapshot.funding_rate) : null;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Market Data</h1>
        <p className="text-sm text-muted-foreground">
          Live crypto prices, market metrics, and BTC technical analysis.
          {snapshot && (
            <>
              {" "}
              Bot data from{" "}
              <span className="font-medium text-foreground">
                {formatRelativeTime(snapshot.taken_at)}
              </span>
              .
            </>
          )}
        </p>
      </div>

      {/* ── Market Metrics Row ── */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard
          title="Total Market Cap"
          value={totalMcap ? `$${(totalMcap / 1e12).toFixed(2)}T` : "—"}
          change={mcapChange24h}
          icon={<Globe className="h-4 w-4" />}
        />
        <MetricCard
          title="BTC Dominance"
          value={btcDom ? `${btcDom.toFixed(1)}%` : "—"}
          hint="Share of total crypto market cap held by Bitcoin"
          icon={<BarChart3 className="h-4 w-4" />}
        />
        <MetricCard
          title="ETH Dominance"
          value={ethDom ? `${ethDom.toFixed(1)}%` : "—"}
          hint="Share held by Ethereum"
          icon={<BarChart3 className="h-4 w-4" />}
        />
        <MetricCard
          title="Fear & Greed"
          value={fearGreed ? String(fearGreed.value) : "—"}
          hint={fearGreed?.label ?? "Crypto market sentiment (0 = extreme fear, 100 = extreme greed)"}
          icon={
            fearGreed && fearGreed.value <= 25 ? (
              <Snowflake className="h-4 w-4" />
            ) : fearGreed && fearGreed.value >= 75 ? (
              <Flame className="h-4 w-4" />
            ) : (
              <Gauge className="h-4 w-4" />
            )
          }
          badge={fearGreed ? fearGreedBadge(fearGreed.value) : undefined}
        />
        <MetricCard
          title="BTC Funding Rate"
          value={fundingRate != null ? formatFundingRate(fundingRate) : "—"}
          hint={
            fundingRate != null
              ? fundingRate > 0
                ? "Positive — longs are paying shorts (crowded long)"
                : fundingRate < 0
                  ? "Negative — shorts are paying longs (crowded short)"
                  : "Neutral"
              : "Perpetual swap funding rate from Hyperliquid"
          }
          icon={<Activity className="h-4 w-4" />}
        />
      </div>

      {/* ── Price Table ── */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Crypto Prices</CardTitle>
          <CardDescription>
            Top assets by market cap — updates every 60 seconds
          </CardDescription>
        </CardHeader>
        <CardContent>
          {coins.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Unable to load prices — CoinGecko may be rate-limited. Refresh in a moment.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">1h</TableHead>
                  <TableHead className="text-right">24h</TableHead>
                  <TableHead className="text-right">7d</TableHead>
                  <TableHead className="text-right">Market Cap</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coins.map((coin, i) => (
                  <TableRow key={coin.id}>
                    <TableCell className="text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={coin.image}
                          alt={coin.name}
                          width={20}
                          height={20}
                          className="rounded-full"
                        />
                        <span className="font-medium">{coin.name}</span>
                        <span className="text-xs uppercase text-muted-foreground">
                          {coin.symbol}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatPrice(coin.current_price)}
                    </TableCell>
                    <TableCell className="text-right">
                      <PctChange value={coin.price_change_percentage_1h_in_currency} />
                    </TableCell>
                    <TableCell className="text-right">
                      <PctChange value={coin.price_change_percentage_24h_in_currency} />
                    </TableCell>
                    <TableCell className="text-right">
                      <PctChange value={coin.price_change_percentage_7d_in_currency} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      ${(coin.market_cap / 1e9).toFixed(1)}B
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── BTC Technical Dashboard ── */}
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-lg font-semibold">BTC Technical Dashboard</h2>
        {snapshot?.macro_filter && (
          <MacroBadge filter={snapshot.macro_filter} />
        )}
      </div>

      {!snapshot ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No bot data yet — start the bot to see technical analysis.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Macro Filter */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Macro Filter</CardTitle>
              <CardDescription>
                Daily EMA200 determines the long-term trend bias
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {snap1D && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">BTC Price</span>
                    <span className="font-mono font-medium">{formatPrice(snap1D.close)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Daily EMA200</span>
                    <span className="font-mono font-medium">{formatPrice(snap1D.ema200)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Distance</span>
                    <span className="font-mono font-medium">
                      <PctChange
                        value={((snap1D.close - snap1D.ema200) / snap1D.ema200) * 100}
                      />
                    </span>
                  </div>
                  <Explanation>
                    {snap1D.close < snap1D.ema200
                      ? `Price is ${(((snap1D.ema200 - snap1D.close) / snap1D.ema200) * 100).toFixed(1)}% below the 200-day moving average — the long-term trend is bearish. The bot only allows short trades in this regime.`
                      : snap1D.close > snap1D.ema200
                        ? `Price is above the 200-day moving average — the long-term trend is bullish. The bot favors long trades.`
                        : `Price is right at the 200-day moving average — neutral zone. Risk is halved near this level.`}
                  </Explanation>
                </>
              )}
            </CardContent>
          </Card>

          {/* Momentum */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Momentum</CardTitle>
              <CardDescription>
                RSI and Stochastic RSI across timeframes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: "15m", snap: snap15m },
                { label: "1H", snap: snap1H },
                { label: "4H", snap: snap4H },
                { label: "1D", snap: snap1D },
              ].map(({ label, snap }) =>
                snap ? (
                  <div key={label} className="space-y-1">
                    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {label}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span>
                        RSI{" "}
                        <span className={rsiColor(snap.rsi14)}>
                          {snap.rsi14.toFixed(1)}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          {rsiLabel(snap.rsi14)}
                        </span>
                      </span>
                      <span>
                        StochK/D{" "}
                        <span className={stochColor(snap.stochK)}>
                          {snap.stochK.toFixed(1)}
                        </span>
                        /
                        <span className={stochColor(snap.stochD)}>
                          {snap.stochD.toFixed(1)}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          {stochLabel(snap.stochK, snap.stochD)}
                        </span>
                      </span>
                    </div>
                  </div>
                ) : null,
              )}
              <Explanation>
                {snap15m && snap15m.stochK > 80 && snap15m.stochD > 80
                  ? "15m StochRSI is overbought — a bearish crossover (K drops below D) could trigger a S3 short signal."
                  : snap15m && snap15m.stochK < 20 && snap15m.stochD < 20
                    ? "15m StochRSI is oversold — a bullish crossover (K rises above D) could trigger a S3 long signal."
                    : "StochRSI is in the neutral zone on 15m — no immediate S3 signal expected."}
                {snap1D
                  ? ` Daily RSI at ${snap1D.rsi14.toFixed(0)} is ${snap1D.rsi14 > 70 ? "overbought — potential pullback ahead" : snap1D.rsi14 < 30 ? "oversold — potential bounce ahead" : "neutral"}.`
                  : ""}
              </Explanation>
            </CardContent>
          </Card>

          {/* Volatility */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Volatility</CardTitle>
              <CardDescription>
                Bollinger Band Width Percentile &amp; Price-MA Range Percentile
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: "15m", snap: snap15m },
                { label: "1H", snap: snap1H },
                { label: "4H", snap: snap4H },
                { label: "1D", snap: snap1D },
              ].map(({ label, snap }) =>
                snap ? (
                  <div key={label} className="space-y-1">
                    <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {label}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span>
                        BBWP{" "}
                        <span className={bbwpColor(snap.bbwp)}>
                          {snap.bbwp.toFixed(1)}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          {snap.bbwp > 80 ? "high vol" : snap.bbwp < 20 ? "low vol" : "moderate"}
                        </span>
                      </span>
                      <span>
                        PMARP{" "}
                        <span className={pmarpColor(snap.pmarp)}>
                          {snap.pmarp.toFixed(1)}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          {snap.pmarp > 80 ? "extended" : snap.pmarp < 20 ? "compressed" : "normal"}
                        </span>
                      </span>
                    </div>
                  </div>
                ) : null,
              )}
              <Explanation>
                <strong>BBWP</strong> measures how wide Bollinger Bands are compared
                to history. High (&gt;80) = volatile market, low (&lt;20) = calm,
                coiled market (breakout likely). <strong>PMARP</strong> measures where
                price sits relative to its historical range. High = price is stretched
                far from its average (overextended), low = compressed near the mean.
                {snap1H && snap1H.bbwp < 35
                  ? " 1H BBWP is low — conditions favor a S2 mean-reversion entry."
                  : " 1H BBWP is above 35 — S2 (mean reversion) is unlikely to fire."}
              </Explanation>
            </CardContent>
          </Card>

          {/* Trend / EMA Alignment */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trend (EMA Alignment)</CardTitle>
              <CardDescription>
                When fast EMAs stack above slow EMAs, the trend is up (and vice versa)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: "15m", snap: snap15m },
                { label: "1H", snap: snap1H },
                { label: "4H", snap: snap4H },
                { label: "1D", snap: snap1D },
              ].map(({ label, snap }) =>
                snap ? (
                  <div key={label} className="space-y-1">
                    <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {label}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <EmaAlignment snap={snap} />
                    </div>
                  </div>
                ) : null,
              )}
              <Explanation>
                EMAs (Exponential Moving Averages) show trend direction. When
                EMA8 &gt; EMA13 &gt; EMA21 &gt; EMA55, all timeframes agree the
                trend is up. The bot&apos;s S1 strategy watches for EMA8/EMA55
                crossovers on the 4H chart.{" "}
                {snap4H && snap4H.ema8 > snap4H.ema55
                  ? "4H EMA8 is above EMA55 — S1 leans bullish."
                  : snap4H && snap4H.ema8 < snap4H.ema55
                    ? "4H EMA8 is below EMA55 — S1 leans bearish."
                    : ""}
              </Explanation>
            </CardContent>
          </Card>
        </div>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Crypto prices from CoinGecko (cached 60s). Technical indicators from the bot&apos;s
        TradingView connection (updated every 15 min). Fear &amp; Greed from alternative.me.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function MetricCard({
  title,
  value,
  change,
  hint,
  icon,
  badge,
}: {
  title: string;
  value: string;
  change?: number | null;
  hint?: string;
  icon: React.ReactNode;
  badge?: { label: string; variant: "default" | "destructive" | "secondary" };
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <div className="text-xl font-semibold tabular-nums">{value}</div>
          {badge && (
            <Badge variant={badge.variant} className="text-[10px]">
              {badge.label}
            </Badge>
          )}
        </div>
        {change != null && (
          <div className="mt-1">
            <PctChange value={change} suffix=" (24h)" />
          </div>
        )}
        {hint && (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

function PctChange({
  value,
  suffix = "",
}: {
  value: number | null | undefined;
  suffix?: string;
}) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const color =
    value > 0 ? "text-green-500" : value < 0 ? "text-red-500" : "text-muted-foreground";
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 text-sm font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(value).toFixed(1)}%{suffix}
    </span>
  );
}

function MacroBadge({
  filter,
}: {
  filter: "bullish" | "bearish" | "neutral";
}) {
  const variant =
    filter === "bullish"
      ? "default"
      : filter === "bearish"
        ? "destructive"
        : "secondary";
  return (
    <Badge variant={variant} className="capitalize">
      {filter === "bullish" ? (
        <TrendingUp className="mr-1 h-3 w-3" />
      ) : filter === "bearish" ? (
        <TrendingDown className="mr-1 h-3 w-3" />
      ) : null}
      {filter}
    </Badge>
  );
}

function EmaAlignment({ snap }: { snap: IndicatorSnapshot }) {
  const emas = [
    { label: "8", value: snap.ema8 },
    { label: "13", value: snap.ema13 },
    { label: "21", value: snap.ema21 },
    { label: "55", value: snap.ema55 },
  ];

  const bullish =
    snap.ema8 > snap.ema13 && snap.ema13 > snap.ema21 && snap.ema21 > snap.ema55;
  const bearish =
    snap.ema8 < snap.ema13 && snap.ema13 < snap.ema21 && snap.ema21 < snap.ema55;

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {emas.map((ema, i) => (
          <span key={ema.label} className="text-xs">
            <span className="text-muted-foreground">EMA{ema.label}</span>
            {i < emas.length - 1 && (
              <span className="mx-0.5">
                {emas[i].value > emas[i + 1].value ? (
                  <span className="text-green-500">&gt;</span>
                ) : emas[i].value < emas[i + 1].value ? (
                  <span className="text-red-500">&lt;</span>
                ) : (
                  <span className="text-muted-foreground">=</span>
                )}
              </span>
            )}
          </span>
        ))}
      </div>
      {bullish && (
        <Badge variant="default" className="text-[10px]">
          aligned up
        </Badge>
      )}
      {bearish && (
        <Badge variant="destructive" className="text-[10px]">
          aligned down
        </Badge>
      )}
      {!bullish && !bearish && (
        <Badge variant="secondary" className="text-[10px]">
          mixed
        </Badge>
      )}
    </div>
  );
}

function Explanation({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rsiColor(v: number) {
  if (v >= 70) return "font-medium text-red-500";
  if (v <= 30) return "font-medium text-green-500";
  return "font-medium";
}

function rsiLabel(v: number) {
  if (v >= 70) return "overbought";
  if (v <= 30) return "oversold";
  if (v >= 60) return "bullish";
  if (v <= 40) return "bearish";
  return "neutral";
}

function stochColor(v: number) {
  if (v >= 80) return "font-medium text-red-500";
  if (v <= 20) return "font-medium text-green-500";
  return "font-medium";
}

function stochLabel(k: number, d: number) {
  if (k > 80 && d > 80) return k > d ? "overbought" : "bearish cross";
  if (k < 20 && d < 20) return k < d ? "oversold" : "bullish cross";
  return "neutral";
}

function bbwpColor(v: number) {
  if (v > 80) return "font-medium text-orange-400";
  if (v < 20) return "font-medium text-blue-400";
  return "font-medium";
}

function pmarpColor(v: number) {
  if (v > 80) return "font-medium text-orange-400";
  if (v < 20) return "font-medium text-blue-400";
  return "font-medium";
}

function fearGreedBadge(value: number): {
  label: string;
  variant: "default" | "destructive" | "secondary";
} {
  if (value <= 25) return { label: "Extreme Fear", variant: "destructive" };
  if (value <= 45) return { label: "Fear", variant: "destructive" };
  if (value <= 55) return { label: "Neutral", variant: "secondary" };
  if (value <= 75) return { label: "Greed", variant: "default" };
  return { label: "Extreme Greed", variant: "default" };
}
