/**
 * Snapshot writers — per-tick state dumps to Supabase.
 *
 * Two write helpers:
 *   writeMarketSnapshot  → market_snapshots table, 1 row per tick
 *   writeRiskSnapshot    → risk_snapshots table,   1 row per tick
 *
 * Both are try/catch-guarded so a Supabase outage never crashes the main loop.
 * Both no-op silently if getSupabase() returns null (env vars missing).
 */

import { getSupabase } from "./supabase";
import { IndicatorSnapshot } from "../tradingview/reader";
import { RiskState } from "../risk/state";
import { ConfluenceResult } from "../strategy/types";

// ---------------------------------------------------------------------------
// market_snapshots
// ---------------------------------------------------------------------------

export type BotSource = "tv-bot" | "vps-bot";

export interface MarketSnapshotInput {
  price: number;
  fundingRate: number | null;
  snap15m: IndicatorSnapshot;
  snap1H: IndicatorSnapshot;
  snap4H: IndicatorSnapshot;
  snap1D: IndicatorSnapshot;
  /** Null if no signals this tick. */
  confluence: ConfluenceResult | null;
  source?: BotSource;
}

/**
 * Computes the macro filter label from Daily snapshot — mirrors the logic in
 * strategy/confluence.ts:getMacroFilter but returns just the text value the
 * schema expects: 'bullish' | 'bearish' | 'neutral'.
 */
function getMacroFilterLabel(snap1D: IndicatorSnapshot): "bullish" | "bearish" | "neutral" {
  const { close, ema200 } = snap1D;
  const distancePct = Math.abs(close - ema200) / ema200;
  if (distancePct <= 0.01) return "neutral"; // within 1% of EMA200 = unclear
  return close > ema200 ? "bullish" : "bearish";
}

export async function writeMarketSnapshot(input: MarketSnapshotInput): Promise<void> {
  const client = getSupabase();
  if (!client) return;

  const row = {
    symbol: "BTC",
    price: input.price,
    funding_rate: input.fundingRate,
    timeframes: {
      "15m": input.snap15m,
      "1H": input.snap1H,
      "4H": input.snap4H,
      "1D": input.snap1D,
    },
    macro_filter: getMacroFilterLabel(input.snap1D),
    confluence_score: input.confluence?.score ?? null,
    source: input.source ?? "tv-bot",
  };

  try {
    const { error } = await client.from("market_snapshots").insert(row);
    if (error) {
      console.error("[Supabase] market_snapshots insert error:", error.message);
    }
  } catch (err) {
    console.error("[Supabase] market_snapshots insert threw:", err);
  }
}

// ---------------------------------------------------------------------------
// risk_snapshots
// ---------------------------------------------------------------------------

export interface RiskSnapshotInput {
  state: Readonly<RiskState>;
  source?: BotSource;
}

export async function writeRiskSnapshot(input: RiskSnapshotInput): Promise<void> {
  const client = getSupabase();
  if (!client) return;

  const s = input.state;

  // Daily DD %: loss as a fraction of the day's starting bankroll. Only meaningful
  // if dailyStartBankroll is set (happens after first trade of day) and dailyPnl < 0.
  const dailyDdPct =
    s.dailyStartBankroll > 0 && s.dailyPnl < 0
      ? -s.dailyPnl / s.dailyStartBankroll
      : 0;

  // Weekly DD %: loss as fraction of current bankroll (matches risk/manager.ts).
  const weeklyDdPct = s.weeklyPnl < 0 && s.bankroll > 0 ? -s.weeklyPnl / s.bankroll : 0;

  const row = {
    bankroll_usd: s.bankroll,
    daily_pnl: s.dailyPnl,
    weekly_pnl: s.weeklyPnl,
    daily_dd_pct: dailyDdPct,
    weekly_dd_pct: weeklyDdPct,
    consecutive_losses: s.consecutiveLosses,
    open_position_count: s.openPositions,
    paused_until: s.pausedUntil > 0 ? new Date(s.pausedUntil).toISOString() : null,
    pause_reason: null as string | null, // not tracked in RiskState yet
    killed: s.killed,
    kill_reason: s.killedReason,
    // Persisted so hydrateRiskState() on startup can restore the daily
    // drawdown budget. 0 means "no trades yet today", which matches the
    // in-memory initial state.
    daily_start_bankroll: s.dailyStartBankroll,
    source: input.source ?? "tv-bot",
  };

  try {
    const { error } = await client.from("risk_snapshots").insert(row);
    if (error) {
      console.error("[Supabase] risk_snapshots insert error:", error.message);
    }
  } catch (err) {
    console.error("[Supabase] risk_snapshots insert threw:", err);
  }
}

// ---------------------------------------------------------------------------
// Hydration reader — used on bot startup to restore the most recent
// persisted risk state into the in-memory RiskState tracker. Read-only.
// ---------------------------------------------------------------------------

/**
 * Shape returned to the hydrator. Fields are intentionally a subset of
 * RiskState — we don't persist `totalExposureUsd` (recomputed from
 * Hyperliquid on first tick) or `openPositions` (same). `lastDailyReset`
 * and `lastWeeklyReset` are derived from `taken_at` by the hydrator, not
 * stored as columns.
 */
export interface HydratedRiskState {
  bankroll: number;
  dailyPnl: number;
  weeklyPnl: number;
  dailyStartBankroll: number;
  consecutiveLosses: number;
  pausedUntil: number;
  killed: boolean;
  killedReason: string | null;
  /** ISO timestamp of the source row — used to derive reset period keys. */
  takenAt: string;
}

/**
 * Read the newest row from `risk_snapshots` and return it in RiskState
 * shape. Returns `null` when Supabase is unavailable, the table is empty,
 * or the query errors — the caller must fall back to initial state.
 * Never throws.
 */
export async function loadLatestRiskState(source?: BotSource): Promise<HydratedRiskState | null> {
  const client = getSupabase();
  if (!client) return null;

  try {
    let query = client
      .from("risk_snapshots")
      .select(
        "bankroll_usd, daily_pnl, weekly_pnl, daily_start_bankroll, consecutive_losses, paused_until, killed, kill_reason, taken_at",
      );

    if (source) {
      query = query.eq("source", source);
    }

    const { data, error } = await query
      .order("taken_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(
        "[Supabase] loadLatestRiskState query error:",
        error.message,
      );
      return null;
    }
    if (!data) return null;

    return {
      bankroll: toNumber(data.bankroll_usd, 0),
      dailyPnl: toNumber(data.daily_pnl, 0),
      weeklyPnl: toNumber(data.weekly_pnl, 0),
      dailyStartBankroll: toNumber(data.daily_start_bankroll, 0),
      consecutiveLosses: Math.max(0, Math.floor(toNumber(data.consecutive_losses, 0))),
      pausedUntil: data.paused_until ? new Date(data.paused_until).getTime() : 0,
      killed: Boolean(data.killed),
      killedReason: data.kill_reason ?? null,
      takenAt: data.taken_at,
    };
  } catch (err) {
    console.error("[Supabase] loadLatestRiskState threw:", err);
    return null;
  }
}

function toNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
