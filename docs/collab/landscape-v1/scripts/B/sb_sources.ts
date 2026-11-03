/** Throwaway (Landscape v1, seat B). Read-only: which bot_logs sources exist, and any order/trailing rows. */
import * as dotenv from "dotenv"; dotenv.config();
import { getSupabase } from "../../../../../src/db/supabase";
(async () => {
  const c = getSupabase(); if (!c) throw new Error("no supabase");
  for (const s of ["orders", "trailing", "risk", "hyperliquid", "bot", "discord", "s2-diag", "s3-diag", "s5", "deadman"]) {
    const { count } = await c.from("bot_logs").select("id", { count: "exact", head: true }).eq("source", s);
    if (count) console.log(`source=${s} count=${count}`);
  }
  const { data } = await c.from("bot_logs").select("ts,source,message").or("message.ilike.%Stop-loss modified%,message.ilike.%[Orders] Market%,message.ilike.%Stop-loss placed%").gte("ts", "2026-08-20").order("ts").limit(200);
  console.log("order/trailing rows:", data?.length);
  for (const r of data ?? []) console.log(r.ts.slice(0, 19), r.source, r.message.slice(0, 150));
  const { data: bal } = await c.from("bot_logs").select("ts,message").eq("source", "bot-vps").ilike("message", "%Balance:%").gte("ts", "2026-08-20").order("ts").limit(1);
  console.log("first balance since 08-20:", bal?.[0]);
  const { data: bal2 } = await c.from("bot_logs").select("ts,message").eq("source", "bot-vps").ilike("message", "%Balance:%").gte("ts", "2026-09-23").order("ts").limit(1);
  console.log("first balance since 09-23:", bal2?.[0]);
  const { data: bal3 } = await c.from("bot_logs").select("ts,message").eq("source", "bot-vps").ilike("message", "%Balance:%").lte("ts", "2026-11-02T17:40").order("ts", { ascending: false }).limit(1);
  console.log("last balance before withdrawal:", bal3?.[0]);
})().catch(e => { console.error(e); process.exit(1); });
