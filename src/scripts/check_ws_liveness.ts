/**
 * Tier-0 Watchlist check WITHOUT ssh — "is the WS bar-close loop alive?"
 *
 * Same signal the VPS dead-man cron uses (newest `[WS] Bar closed` row in
 * Supabase `bot_logs`), but read-only and runnable from any machine: no ssh
 * key, no pm2, and it never posts to Discord or touches the dead-man state file.
 *
 * Built S51 because the laptop had no working ssh key for the VPS and pm2
 * "online" does not mean the bar-close loop is alive (S44: 7d dead, S48: 54d dead).
 *
 * The clock comes from Hyperliquid's latest candle, never from this machine --
 * the local clock was found ~2h behind reality in S51 and ~35h off in S46.
 *
 * Usage: npx ts-node src/scripts/check_ws_liveness.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getSupabase } from "../db/supabase";

const STALE_MINUTES = 35; // same threshold as deploy/deadman-check.cjs

async function exchangeNowMs(): Promise<number> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: { coin: "BTC", interval: "15m", startTime: Date.now() - 6 * 60 * 60_000, endTime: Date.now() + 60 * 60_000 },
    }),
  });
  const candles = (await res.json()) as Array<{ t: number; T: number; c: string }>;
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error("Hyperliquid returned no candles - cannot establish the true clock");
  }
  return candles[candles.length - 1].t;
}

async function main(): Promise<void> {
  const client = getSupabase();
  if (!client) {
    console.error("[Liveness] Supabase env vars missing - cannot read bot_logs.");
    process.exit(1);
  }

  // The local clock is not trusted; ask the exchange.
  const nowMs = await exchangeNowMs();
  console.log(`\n[Liveness] Exchange clock (latest 15m candle open): ${new Date(nowMs).toISOString()}`);
  const localSkewMin = Math.round((Date.now() - nowMs) / 60_000);
  console.log(`[Liveness] This machine's clock is ${localSkewMin >= 0 ? "+" : ""}${localSkewMin} min vs that candle open`);

  const { data, error } = await client
    .from("bot_logs")
    .select("ts, source, message")
    .ilike("message", "%Bar closed%")
    .order("ts", { ascending: false })
    .limit(1);

  if (error) {
    console.error(`[Liveness] bot_logs query failed: ${error.message}`);
    process.exit(1);
  }
  if (!data || data.length === 0) {
    console.error("[Liveness] NO `Bar closed` rows found at all. Either the bot has never logged one, or retention dropped them.");
    process.exit(2);
  }

  const row = data[0];
  const barMs = Date.parse(row.ts);
  const ageMin = Math.round((nowMs - barMs) / 60_000);

  console.log(`\n[Liveness] Newest bar close: ${row.ts} (source=${row.source})`);
  console.log(`[Liveness] Age vs exchange clock: ${ageMin} min`);

  if (ageMin > STALE_MINUTES) {
    const days = (ageMin / 60 / 24).toFixed(1);
    console.error(`\n  VERDICT: STALE - the bar-close loop is NOT alive (${ageMin} min / ${days} days old, threshold ${STALE_MINUTES} min).`);
    console.error(`  This is the S44/S48 failure mode. Check pm2 and the reconnect watchdog on the VPS.`);
    process.exit(3);
  }

  console.log(`\n  VERDICT: ALIVE - bar closes are current (${ageMin} min old, threshold ${STALE_MINUTES} min).`);
  console.log("");
}

main().catch(err => {
  console.error("[Liveness] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
