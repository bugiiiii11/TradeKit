/**
 * Trades writer — one row per closed trade.
 *
 * The bot calls insertClosedTrade() from checkExits() after a position is
 * exited and PnL is computed. Open trades are NOT written here — their live
 * state lives in public.positions (via syncPositions). Only closed trades
 * land in public.trades with exit_time populated.
 *
 * Graceful: no-ops silently if Supabase is unavailable. Errors caught inside.
 */

import { getSupabase } from "./supabase";
import { Direction, StrategyId } from "../strategy/types";

export type TradeSource = "bot" | "manual" | "tv-bot" | "vps-bot";

export interface ClosedTradeInput {
  strategy: StrategyId;
  direction: Direction;
  symbol: string;
  size: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: string; // ISO timestamp
  exitTime: string;  // ISO timestamp
  pnlUsd: number;
  /** Risk in dollars from sizing — used to compute pnl_r. May be 0 in edge cases. */
  riskDollar: number;
  leverage: number;
  confluenceScore: number;
  stopDistancePct: number;
  exitReason: string;
  /** "bot" for strategy-driven trades, "manual" for test_custom_trade.ts. Default: "bot". */
  source?: TradeSource;
  /** Optional extras (fills info, slippage) that we do not track yet. */
  feesUsd?: number | null;
  slippageBps?: number | null;
}

export async function insertClosedTrade(input: ClosedTradeInput): Promise<void> {
  const client = getSupabase();
  if (!client) return;

  // pnl_r = pnl in units of risked dollars. Guard against divide-by-zero.
  const pnlR = input.riskDollar > 0 ? input.pnlUsd / input.riskDollar : 0;

  const row = {
    strategy_config_id: null as string | null, // wired up once strategy_configs exists
    symbol: input.symbol,
    side: input.direction,
    size: input.size,
    entry_price: input.entryPrice,
    exit_price: input.exitPrice,
    entry_time: input.entryTime,
    exit_time: input.exitTime,
    pnl_usd: input.pnlUsd,
    pnl_r: pnlR,
    fees_usd: input.feesUsd ?? null,
    slippage_bps: input.slippageBps ?? null,
    exit_reason: input.exitReason,
    source: input.source ?? "bot",
    entry_conditions: {
      strategy: input.strategy,
      leverage: input.leverage,
      confluence_score: input.confluenceScore,
      stop_distance_pct: input.stopDistancePct,
    },
  };

  try {
    const { error } = await client.from("trades").insert(row);
    if (error) {
      console.error("[Supabase] trades insert error:", error.message);
    }
  } catch (err) {
    console.error("[Supabase] trades insert threw:", err);
  }
}
