/**
 * One-shot forensics for S44: identify which strategy opened the 2026-06-10 LONG,
 * and pull the closed S6 SHORT trade row for post-trade analysis.
 * Usage: npx ts-node src/scripts/investigate_long.ts
 */

import "dotenv/config";
import { getSupabase } from "../db/supabase";

async function main() {
  const client = getSupabase();
  if (!client) {
    console.error("No Supabase client — env missing.");
    process.exit(1);
  }

  // --- 1. Closed SHORT trade (S43 first bot trade) ---
  console.log("\n=== CLOSED TRADES (last 6, vps-bot/bot) ===");
  const { data: trades, error: tErr } = await client
    .from("trades")
    .select("strategy_config_id, symbol, side, size, entry_price, exit_price, entry_time, exit_time, pnl_usd, pnl_r, fees_usd, exit_reason, source, entry_conditions")
    .order("exit_time", { ascending: false })
    .limit(6);
  if (tErr) console.error("trades error:", tErr.message);
  else for (const t of trades ?? []) {
    console.log(`${t.exit_time} | ${t.side} | entry ${t.entry_price} -> exit ${t.exit_price} | pnl $${t.pnl_usd} (${t.pnl_r}R) | ${t.exit_reason} | src=${t.source} | cond=${JSON.stringify(t.entry_conditions)}`);
  }

  // --- 2. Open position row ---
  console.log("\n=== OPEN POSITIONS (live mirror) ===");
  const { data: pos, error: pErr } = await client
    .from("positions")
    .select("hl_position_id, side, size, entry_price, mark_price, unrealized_pnl, synced_at");
  if (pErr) console.error("positions error:", pErr.message);
  else for (const p of pos ?? []) console.log(JSON.stringify(p));

  // --- 3. bot_logs around the LONG entry 2026-06-10 17:00 UTC ---
  console.log("\n=== BOT LOGS around 2026-06-10 16:40-17:20 UTC (entry signal) ===");
  const { data: logs, error: lErr } = await client
    .from("bot_logs")
    .select("ts, level, message")
    .gte("ts", "2026-06-10T16:40:00Z")
    .lte("ts", "2026-06-10T17:20:00Z")
    .order("ts", { ascending: true })
    .limit(300);
  if (lErr) console.error("bot_logs error:", lErr.message);
  else {
    console.log(`(${logs?.length ?? 0} rows)`);
    for (const l of logs ?? []) {
      const m = String(l.message);
      if (/S1|S6|S2|entry|signal|enter|long|order|sizing|confluence|trade|open/i.test(m)) {
        console.log(`${l.ts} [${l.level}] ${m}`);
      }
    }
  }

  // --- 4. Most recent bot_logs (is the Supabase write path alive post-restart?) ---
  console.log("\n=== MOST RECENT BOT LOGS (write-path liveness) ===");
  const { data: recent, error: rErr } = await client
    .from("bot_logs")
    .select("ts, level, message")
    .order("ts", { ascending: false })
    .limit(8);
  if (rErr) console.error("recent bot_logs error:", rErr.message);
  else for (const l of (recent ?? []).reverse()) console.log(`${l.ts} [${l.level}] ${String(l.message).slice(0,120)}`);

  // --- 5. Errors / Supabase / position-sync logs since the Jun 13 restart ---
  console.log("\n=== ERROR/SUPABASE/POSITION logs since Jun 13 ===");
  const { data: errs, error: eErr } = await client
    .from("bot_logs")
    .select("ts, level, message")
    .gte("ts", "2026-06-13T00:00:00Z")
    .or("level.eq.error,message.ilike.%Supabase%,message.ilike.%position%,message.ilike.%sync%")
    .order("ts", { ascending: false })
    .limit(20);
  if (eErr) console.error("err query:", eErr.message);
  else {
    console.log(`(${errs?.length ?? 0} rows)`);
    for (const l of errs ?? []) console.log(`${l.ts} [${l.level}] ${String(l.message).slice(0, 160)}`);
  }

  // --- 6. Any signal/order activity since Jun 13? ---
  console.log("\n=== SIGNAL/ORDER logs since Jun 13 ===");
  const { data: sig } = await client
    .from("bot_logs")
    .select("ts, message")
    .gte("ts", "2026-06-13T00:00:00Z")
    .or("message.ilike.%SIGNAL%,message.ilike.%[Orders]%,message.ilike.%Trade logged%")
    .order("ts", { ascending: false })
    .limit(10);
  console.log(`(${sig?.length ?? 0} rows)`);
  for (const l of sig ?? []) console.log(`${l.ts} ${String(l.message).slice(0, 140)}`);

  // --- 7. Most-recent log per category (is the bar-close loop alive?) ---
  console.log("\n=== MOST RECENT LOG PER CATEGORY ===");
  for (const pat of ["%Bot-VPS%", "%S6-diag%", "%Cascade received%", "%Heartbeat%", "%reconnect%", "%hydrat%"]) {
    const { data } = await client
      .from("bot_logs")
      .select("ts, message")
      .ilike("message", pat)
      .order("ts", { ascending: false })
      .limit(1);
    const r = data && data[0];
    console.log(pat.padEnd(22), "->", r ? r.ts : "(none)", r ? "| " + String(r.message).slice(0, 70) : "");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
