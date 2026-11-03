/** Throwaway (Landscape v1, seat B). Read-only pulls from bot_logs: webhook heartbeats, bot-vps trade lines, ws bar closes near fills. Writes JSON to argv[2]. */
import * as dotenv from "dotenv"; dotenv.config();
import { getSupabase } from "../../../../../src/db/supabase";
async function all(q: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = []; for (let i = 0; i < 200; i++) { const { data, error } = await q(i * 1000, i * 1000 + 999); if (error) throw error; out.push(...(data ?? [])); if (!data || data.length < 1000) break; } return out;
}
(async () => {
  const c = getSupabase(); if (!c) throw new Error("no supabase");
  const webhook = await all((a, b) => c.from("bot_logs").select("ts,level,message").eq("source", "webhook").gte("ts", "2026-06-01T00:00:00Z").order("ts", { ascending: true }).range(a, b));
  const botvps = await all((a, b) => c.from("bot_logs").select("ts,level,message").eq("source", "bot-vps").gte("ts", "2026-08-20T00:00:00Z").order("ts", { ascending: true }).range(a, b));
  const main = await all((a, b) => c.from("bot_logs").select("ts,level,message").eq("source", "main").gte("ts", "2026-08-20T00:00:00Z").order("ts", { ascending: true }).range(a, b));
  const ws = await all((a, b) => c.from("bot_logs").select("ts,level,message").eq("source", "ws").gte("ts", "2026-08-20T00:00:00Z").not("message", "ilike", "%Bar closed%").order("ts", { ascending: true }).range(a, b));
  const { count: barCloses } = await c.from("bot_logs").select("id", { count: "exact", head: true }).eq("source", "ws").ilike("message", "%Bar closed%").gte("ts", "2026-08-20T00:00:00Z");
  const { data: firstBar } = await c.from("bot_logs").select("ts").eq("source", "ws").ilike("message", "%Bar closed%").gte("ts", "2026-08-20T00:00:00Z").order("ts", { ascending: true }).limit(1);
  const { data: lastBar } = await c.from("bot_logs").select("ts,message").eq("source", "ws").ilike("message", "%Bar closed%").order("ts", { ascending: false }).limit(1);
  const s1d = await all((a, b) => c.from("bot_logs").select("ts,message").eq("source", "s1-diag").gte("ts", "2026-08-20T00:00:00Z").order("ts", { ascending: true }).range(a, b));
  const s6d = await all((a, b) => c.from("bot_logs").select("ts,message").eq("source", "s6-diag").gte("ts", "2026-08-20T00:00:00Z").order("ts", { ascending: true }).range(a, b));
  const snaps = await all((a, b) => c.from("market_snapshots").select("taken_at,price,funding_rate,source").gte("taken_at", "2026-08-20T00:00:00Z").order("taken_at", { ascending: true }).range(a, b));
  const bt = await all((a, b) => c.from("backtest_runs").select("*").order("created_at", { ascending: false }).range(a, b));
  require("fs").writeFileSync(process.argv[2], JSON.stringify({ webhook, botvps, main, ws, barCloses, firstBar, lastBar, s1d, s6d, snaps, bt }));
  console.log(`webhook=${webhook.length} botvps=${botvps.length} main=${main.length} ws(non-barclose)=${ws.length} barCloses=${barCloses} first=${firstBar?.[0]?.ts} last=${lastBar?.[0]?.ts} s1d=${s1d.length} s6d=${s6d.length} snaps=${snaps.length} bt=${bt.length}`);
})().catch(e => { console.error(e); process.exit(1); });
