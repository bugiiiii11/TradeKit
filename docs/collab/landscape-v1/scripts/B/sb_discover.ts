/** Throwaway (Landscape v1, seat B). Read-only Supabase schema/volume discovery. */
import * as dotenv from "dotenv"; dotenv.config();
import { getSupabase } from "../../../../../src/db/supabase";
(async () => {
  const c = getSupabase(); if (!c) throw new Error("no supabase");
  for (const t of ["trades", "positions", "bot_logs", "market_snapshots", "backtest_runs", "risk_snapshots", "bot_commands"]) {
    const { data, error, count } = await c.from(t).select("*", { count: "exact" }).order("created_at", { ascending: false }).limit(1);
    if (error) { const r2 = await c.from(t).select("*", { count: "exact" }).limit(1); console.log(`\n## ${t} count=${r2.count} err=${error.message}`); console.log(JSON.stringify(r2.data?.[0], null, 0)); continue; }
    console.log(`\n## ${t} count=${count}`); console.log(JSON.stringify(data?.[0], null, 0));
  }
  // bot_logs source mix since 2026-08-20
  for (const s of ["ws","main","bot-vps","commands","webhook","s1-diag","s6-diag"]) {
    const { count } = await c.from("bot_logs").select("id", { count: "exact", head: true }).eq("source", s).gte("ts", "2026-08-20T00:00:00Z");
    const { data: first } = await c.from("bot_logs").select("ts").eq("source", s).order("ts", { ascending: true }).limit(1);
    console.log(`bot_logs source=${s} since 08-20 count=${count} first_ever=${first?.[0]?.ts}`);
  }
  const { data: tr } = await c.from("trades").select("*").gte("exit_time", "2026-06-01T00:00:00Z").order("exit_time", { ascending: true });
  console.log(`\n## trades since 2026-06-01: ${tr?.length}`);
  for (const r of tr ?? []) console.log(JSON.stringify(r));
  const { data: pos } = await c.from("positions").select("*");
  console.log(`\n## positions rows: ${pos?.length}`); for (const r of pos ?? []) console.log(JSON.stringify(r));
})().catch(e => { console.error(e); process.exit(1); });
