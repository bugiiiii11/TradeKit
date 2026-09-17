import { Activity, BookOpen, Layers3, Sparkles, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AnimateIn } from "@/components/animate-in";
import { formatUsd } from "@/lib/format";

type StrategyTemplate = {
  id: string;
  name: string;
  description: string | null;
  param_schema: ParamSchema | null;
  created_at: string;
};

type ParamSchema = {
  groups?: Record<string, string[]>;
  properties?: Record<string, ParamProperty>;
};

type ParamProperty = {
  type?: string;
  enum?: string[];
  default?: unknown;
  description?: string;
  min?: number;
  max?: number;
};

type TradeForStats = {
  strategy_config_id: string | null;
  pnl_usd: number | string | null;
  source: "bot" | "manual" | null;
  entry_conditions: { strategy?: string } | null;
};

type TemplateStats = { count: number; wins: number; pnlUsd: number };

/**
 * Live status per strategy id. The bot writes the strategy into
 * trades.entry_conditions.strategy (strategy_config_id is always null until a
 * config editor exists), so stats are joined on that field. S2/S3 stay listed
 * for history; S6 runs live but has no strategy_templates row yet, so a
 * fallback card is rendered when the DB lacks it.
 */
const STATUS_BY_ID: Record<string, { live: boolean; reason: string }> = {
  s1: { live: true, reason: "Enabled on the VPS bot (10x)" },
  s6: { live: true, reason: "Enabled on the VPS bot (8x)" },
  s2: { live: false, reason: "Disabled: -$30 / 31% WR over 26 months (Session 31 backtest)" },
  s3: { live: false, reason: "Disabled: -$82 / PF 0.51 over 379 days (Session 28 backtest)" },
};

const S6_FALLBACK: StrategyTemplate = {
  id: "s6",
  name: "BBWP Volatility Breakout",
  description:
    "Trend-following breakout on 1H. Enters when BBWP crosses above 50 after a recent compression (<20 within 40 bars); direction from price vs 1H EMA21. 2% stop. Exits on 1H EMA8/55 reverse cross or when the BBWP expansion cycle completes (>85 then <35). Bypasses the confluence scorer.",
  param_schema: {
    groups: { risk: ["stop_distance_pct", "default_leverage"], timeframes: ["primary_tf"], entry: ["compression_threshold", "expansion_threshold", "compression_lookback"] },
    properties: {
      stop_distance_pct: { type: "number", default: 0.02 },
      default_leverage: { type: "number", default: 8 },
      primary_tf: { type: "string", default: "1H" },
      compression_threshold: { type: "number", default: 20 },
      expansion_threshold: { type: "number", default: 50 },
      compression_lookback: { type: "number", default: 40 },
    },
  },
  created_at: "",
};

type StrategyConfigRef = {
  id: string;
  template_id: string;
  name: string | null;
  enabled: boolean;
};

export const dynamic = "force-dynamic";

const ICON_BY_ID: Record<string, React.ReactNode> = {
  s1: <Layers3 className="h-5 w-5" />,
  s2: <BookOpen className="h-5 w-5" />,
  s3: <Zap className="h-5 w-5" />,
  s6: <Activity className="h-5 w-5" />,
};

export default async function StrategiesPage() {
  const supabase = await createClient();

  const [{ data: templateRows }, { data: configRows }, { data: tradeRows }] =
    await Promise.all([
      supabase.from("strategy_templates").select("*").order("id"),
      supabase
        .from("strategy_configs")
        .select("id, template_id, name, enabled"),
      supabase
        .from("trades")
        .select("strategy_config_id, pnl_usd, source, entry_conditions"),
    ]);

  const dbTemplates = (templateRows ?? []) as StrategyTemplate[];
  const templates = dbTemplates.some((t) => t.id === "s6")
    ? dbTemplates
    : [...dbTemplates, S6_FALLBACK];
  const configs = (configRows ?? []) as StrategyConfigRef[];
  const trades = (tradeRows ?? []) as TradeForStats[];

  // Stats per template id, joined on entry_conditions.strategy (lowercased).
  const statsByTemplate = new Map<string, TemplateStats>();
  for (const t of trades) {
    if (t.source === "manual") continue;
    if (t.pnl_usd === null || t.pnl_usd === undefined) continue;
    const id = t.entry_conditions?.strategy?.toLowerCase();
    if (!id) continue;
    const pnl = Number(t.pnl_usd);
    if (!Number.isFinite(pnl)) continue;
    const prev = statsByTemplate.get(id) ?? { count: 0, wins: 0, pnlUsd: 0 };
    prev.count += 1;
    if (pnl > 0) prev.wins += 1;
    prev.pnlUsd += pnl;
    statsByTemplate.set(id, prev);
  }

  // Build template → [config.id] map so we can aggregate trades by template.
  const configsByTemplate = new Map<string, StrategyConfigRef[]>();
  for (const c of configs) {
    const list = configsByTemplate.get(c.template_id) ?? [];
    list.push(c);
    configsByTemplate.set(c.template_id, list);
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Strategies</h1>
        <p className="text-sm text-muted-foreground">
          Every strategy the bot has run. S1 and S6 are live on the VPS bot;
          S2 and S3 are kept for history and were disabled after their
          backtests went negative. Live stats are all-time, joined on the
          strategy each trade was opened with.
        </p>
      </div>

      <AnimateIn>
      {templates.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No strategy templates found. Seed{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              strategy_templates
            </code>{" "}
            via the Supabase migration to continue.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {[...templates]
            .sort((a, b) => Number(!isLive(a.id)) - Number(!isLive(b.id)) || a.id.localeCompare(b.id))
            .map((tpl) => {
              const tplConfigs = configsByTemplate.get(tpl.id) ?? [];
              const agg = statsByTemplate.get(tpl.id) ?? { count: 0, wins: 0, pnlUsd: 0 };
              return (
                <StrategyCard
                  key={tpl.id}
                  template={tpl}
                  configs={tplConfigs}
                  stats={agg}
                />
              );
            })}
        </div>
      )}
      </AnimateIn>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Strategy parameters are defined in{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          strategy_templates.param_schema
        </code>
        . Once the Strategies UI supports editing, you&apos;ll be able to
        create per-strategy configs from this page.
      </p>
    </>
  );
}

function isLive(id: string): boolean {
  return STATUS_BY_ID[id]?.live ?? false;
}

function StrategyCard({
  template,
  configs,
  stats,
}: {
  template: StrategyTemplate;
  configs: StrategyConfigRef[];
  stats: TemplateStats;
}) {
  const icon = ICON_BY_ID[template.id] ?? (
    <Sparkles className="h-5 w-5" />
  );
  const status = STATUS_BY_ID[template.id];
  const schema = template.param_schema ?? {};
  const properties = schema.properties ?? {};

  // Pick a few interesting params to highlight: first 4 from each group.
  const highlightedKeys = pickHighlightedParams(schema);

  const winRate =
    stats.count > 0 ? Math.round((stats.wins / stats.count) * 100) : null;

  return (
    <Card className={`flex h-full flex-col ${status && !status.live ? "opacity-70" : ""}`}>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            {icon}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{template.name}</CardTitle>
              <Badge variant="outline" className="font-mono text-[10px]">
                {template.id.toUpperCase()}
              </Badge>
              {status && (
                <Badge
                  variant={status.live ? "default" : "secondary"}
                  className="text-[10px]"
                  title={status.reason}
                >
                  {status.live ? "LIVE" : "DISABLED"}
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs">
              {configs.length} config{configs.length === 1 ? "" : "s"} ·{" "}
              {configs.filter((c) => c.enabled).length} enabled
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <p className="text-sm text-muted-foreground">{template.description}</p>
        {status && !status.live && (
          <p className="text-xs text-muted-foreground">{status.reason}</p>
        )}

        {/* Live stats */}
        <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/30 p-3">
          <Stat
            label="Trades"
            value={`${stats.count}`}
            hint={stats.count === 0 ? "No runs yet" : undefined}
          />
          <Stat
            label="Win Rate"
            value={winRate !== null ? `${winRate}%` : "—"}
          />
          <Stat
            label="PnL"
            value={stats.count > 0 ? formatUsd(stats.pnlUsd) : "—"}
            tone={
              stats.pnlUsd > 0
                ? "positive"
                : stats.pnlUsd < 0
                  ? "negative"
                  : "default"
            }
          />
        </div>

        {/* Key parameters */}
        <div>
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Key Parameters
          </div>
          {highlightedKeys.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              No parameters defined.
            </div>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {highlightedKeys.map((key) => {
                const prop = properties[key];
                if (!prop) return null;
                return (
                  <li
                    key={key}
                    className="flex items-start justify-between gap-2"
                  >
                    <span className="truncate font-mono text-muted-foreground">
                      {key}
                    </span>
                    <span className="shrink-0 font-mono">
                      {formatParamDefault(prop)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
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
    <div className="flex flex-col">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`text-sm font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
      {hint && (
        <div className="text-[10px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

function pickHighlightedParams(schema: ParamSchema): string[] {
  const groups = schema.groups ?? {};
  // Prefer risk + timeframes groups first, then entry.
  const order = ["risk", "timeframes", "entry", "exit"];
  const picked: string[] = [];
  for (const g of order) {
    const keys = groups[g] ?? [];
    for (const k of keys) {
      if (picked.length >= 6) break;
      if (!picked.includes(k)) picked.push(k);
    }
    if (picked.length >= 6) break;
  }
  // Fallback — first 6 property keys.
  if (picked.length === 0 && schema.properties) {
    return Object.keys(schema.properties).slice(0, 6);
  }
  return picked;
}

function formatParamDefault(prop: ParamProperty): string {
  const d = prop.default;
  if (d === undefined || d === null) return "—";
  if (typeof d === "number") {
    // Fractions like 0.005 → show as-is. Integers unchanged.
    return d.toString();
  }
  if (typeof d === "string") return d;
  if (typeof d === "boolean") return d ? "true" : "false";
  return JSON.stringify(d);
}
