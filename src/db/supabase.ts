/**
 * Supabase client — bot-side (service role).
 *
 * The bot writes market_snapshots, risk_snapshots, trades, positions, bot_logs
 * using the SERVICE ROLE key, which bypasses Row-Level Security. This key must
 * NEVER leave the local machine or be shipped to any frontend bundle.
 *
 * Graceful degradation: if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing
 * from the environment, getSupabase() returns null and callers should no-op
 * their writes. This lets the bot run fine without Supabase configured — useful
 * for local dev, CI, or partial rollbacks.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null | undefined;

/**
 * Returns a lazily-initialized Supabase client, or null if the env vars are
 * missing. The first call emits one warning; subsequent calls are silent.
 */
export function getSupabase(): SupabaseClient | null {
  if (_client !== undefined) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn(
      "[Supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — " +
        "bot will skip all Supabase writes."
    );
    _client = null;
    return null;
  }

  _client = createClient(url, key, {
    auth: {
      // Service role — no session persistence, no auto-refresh
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  console.log("[Supabase] Client initialized (service role)");
  return _client;
}
