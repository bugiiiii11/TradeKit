/**
 * Watchlist check WITHOUT ssh -- "is the command bus (kill switch) healthy?"
 *
 * Reads the `commands` rows in Supabase `bot_logs` and reports whether the
 * Realtime channel is stable or flapping.
 *
 * Built S52, after the channel was found resubscribing every 30s since
 * 2026-08-21 (2,880 cycles/day, ~11.5k junk rows/day into bot_logs -- 96% of
 * the whole log). Root cause was self-inflicted: `removeChannel()` fires the
 * channel's own subscribe callback with CLOSED, which the CLOSED branch read
 * as "the server dropped us" and used to arm another resubscribe, forever.
 *
 * Healthy looks like: a handful of rows per day, mostly at bot restarts.
 * Flapping looks like: ~120 closes/hour, evenly spaced 30s apart.
 *
 * Usage: npx ts-node src/scripts/check_command_channel.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getSupabase } from "../db/supabase";

const WINDOW_HOURS = 2;
/** Above this many closes per hour the channel is cycling, not recovering. */
const FLAP_THRESHOLD_PER_HOUR = 6;

async function main(): Promise<void> {
  const client = getSupabase();
  if (!client) {
    console.error("[Commands] Supabase env vars missing - cannot read bot_logs.");
    process.exit(1);
  }

  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();

  const { data: rows, error } = await client
    .from("bot_logs")
    .select("ts, level, message")
    .eq("source", "commands")
    .gte("ts", since)
    .order("ts", { ascending: false });

  if (error) {
    console.error(`[Commands] bot_logs query failed: ${error.message}`);
    process.exit(1);
  }

  const all = rows ?? [];
  const closes = all.filter((r) => /subscription closed/i.test(r.message));
  const actives = all.filter((r) => /subscription active/i.test(r.message));
  const errors = all.filter((r) => /CHANNEL_ERROR|TIMED_OUT/i.test(r.message));
  const perHour = closes.length / WINDOW_HOURS;

  console.log(`\n[Commands] Window: last ${WINDOW_HOURS}h`);
  console.log(`[Commands] Rows: ${all.length} total | ${closes.length} closed | ${actives.length} active | ${errors.length} error`);
  console.log(`[Commands] Close rate: ${perHour.toFixed(1)}/hour`);

  if (all.length === 0) {
    console.log("\n  VERDICT: SILENT - no command-channel activity at all.");
    console.log("  That is normal for a stable channel (it only logs on state change),");
    console.log("  but confirm the bot is up with check_ws_liveness.ts.");
    return;
  }

  console.log(`[Commands] Newest line: ${all[0].ts}  ${all[0].message}`);

  if (perHour >= FLAP_THRESHOLD_PER_HOUR) {
    const gaps: number[] = [];
    for (let i = 0; i < Math.min(closes.length - 1, 20); i++) {
      gaps.push((Date.parse(closes[i].ts) - Date.parse(closes[i + 1].ts)) / 1000);
    }
    const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    console.log(`[Commands] Mean interval between closes: ${avg.toFixed(1)}s`);
    console.log(`\n  VERDICT: FLAPPING - the channel is cycling, not recovering.`);
    console.log(`  Kill switch still works but with up to ~${avg.toFixed(0)}s latency (each`);
    console.log(`  resubscribe runs a startup sweep that claims pending commands).`);
    console.log(`  If the mean interval is ~30s, the S52 fix in src/db/commands.ts is NOT deployed.`);
    process.exitCode = 1;
    return;
  }

  console.log("\n  VERDICT: HEALTHY - no resubscribe cycling in this window.");
}

main().catch((err) => {
  console.error("[Commands] Check failed:", err);
  process.exit(1);
});
