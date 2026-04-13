/**
 * Positions sync — live Hyperliquid state mirror.
 *
 * Each tick we fetch the open positions from Hyperliquid and mirror them into
 * public.positions. The table is a "live snapshot" — rows are upserted by
 * synthetic key (symbol + side), and any row whose key is no longer present on
 * Hyperliquid is deleted. Closed positions move out of `positions` and only
 * live on in `trades` (via insertClosedTrade).
 *
 * Synthetic key rationale: Hyperliquid does not expose a stable position id,
 * but on a single account there is at most one long and one short per coin.
 * `${coin}_${direction}` (e.g. "BTC_long") is therefore a natural unique key.
 *
 * Graceful: no-ops silently if Supabase client is unavailable. All Supabase
 * calls are try/catch-guarded so a DB outage never crashes the loop.
 */

import { getSupabase } from "./supabase";
import { PositionInfo } from "../hyperliquid/account";

export interface MarkPriceLookup {
  /** Symbol → current mark price (usually the latest close). */
  [symbol: string]: number;
}

/**
 * Mirrors the current Hyperliquid open positions into public.positions.
 *
 * @param positions    Current positions as returned by getOpenPositions()
 * @param marks        Optional mark-price lookup for unrealized PnL freshness
 */
export async function syncPositions(
  positions: PositionInfo[],
  marks: MarkPriceLookup = {}
): Promise<void> {
  const client = getSupabase();
  if (!client) return;

  try {
    // Build the rows we want live in the table right now.
    const rows = positions.map((p) => {
      const markPrice = marks[p.coin] ?? p.entryPrice;
      return {
        hl_position_id: `${p.coin}_${p.direction}`,
        symbol: p.coin,
        side: p.direction,
        size: p.sizeBase,
        entry_price: p.entryPrice,
        mark_price: markPrice,
        unrealized_pnl: p.unrealizedPnl,
        liquidation_price: null as number | null, // not returned by getOpenPositions()
        leverage: null as number | null,          // ditto
        strategy_config_id: null as string | null, // wired up once strategy_configs exists
        opened_at: null as string | null,         // HL does not expose this
        synced_at: new Date().toISOString(),
      };
    });

    // Upsert current positions. Passing an empty array is valid and becomes a no-op.
    if (rows.length > 0) {
      const { error } = await client
        .from("positions")
        .upsert(rows, { onConflict: "hl_position_id" });
      if (error) {
        console.error("[Supabase] positions upsert error:", error.message);
        return; // don't delete stale rows if upsert failed
      }
    }

    // Delete any rows whose hl_position_id is NOT in the current set. This is
    // how closed positions disappear from the live table. If rows.length === 0
    // we still want to run this so a freshly-flat account clears stragglers.
    const currentIds = rows.map((r) => r.hl_position_id);
    const deleteQuery = client.from("positions").delete();
    if (currentIds.length > 0) {
      const { error } = await deleteQuery.not(
        "hl_position_id",
        "in",
        `(${currentIds.map((id) => `"${id}"`).join(",")})`
      );
      if (error) {
        console.error("[Supabase] positions stale-delete error:", error.message);
      }
    } else {
      // No positions → truncate the table (delete all rows).
      const { error } = await deleteQuery.not("hl_position_id", "is", null);
      if (error) {
        console.error("[Supabase] positions full-delete error:", error.message);
      }
    }
  } catch (err) {
    console.error("[Supabase] syncPositions threw:", err);
  }
}
