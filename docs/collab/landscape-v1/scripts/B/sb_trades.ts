/** Throwaway (Landscape v1, seat B). Read-only: dump all closed trades + sample log rows to JSON (argv[2]). */
import * as dotenv from "dotenv"; dotenv.config();
import { getSupabase } from "../../../../../src/db/supabase";
(async () => {
  const c = getSupabase(); if (!c) throw new Error("no supabase");
  const { data: trades } = await c.from("trades").select("*").order("exit_time", { ascending: true });
  const { data: bars } = await c.from("bot_logs").select("ts,message").eq("source", "ws").ilike("message", "%Bar closed%").gte("ts", "2026-10-16T16:00:00Z").lte("ts", "2026-10-16T17:00:00Z").order("ts");
  const { data: cmds } = await c.from("bot_commands").select("*").order("created_at", { ascending: false }).limit(60);
  require("fs").writeFileSync(process.argv[2], JSON.stringify({ trades, bars, cmds }));
  console.log(`trades=${trades?.length} bars=${bars?.length} cmds=${cmds?.length}`);
  for (const b of bars ?? []) console.log(b.ts, b.message);
  console.log("cmd types:", JSON.stringify((cmds ?? []).map((x: any) => [x.created_at?.slice(0,16), x.command ?? x.type, x.status])));
})().catch(e => { console.error(e); process.exit(1); });
