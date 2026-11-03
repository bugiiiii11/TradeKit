/** Throwaway (Landscape v1, seat B). Read-only: dump bot_logs source in (orders, hyperliquid, trailing, discord, bot) since 2026-08-20 to JSON argv[2]. */
import * as dotenv from "dotenv"; dotenv.config();
import { getSupabase } from "../../../../../src/db/supabase";
(async () => {
  const c = getSupabase(); if (!c) throw new Error("no supabase");
  const out: Record<string, any[]> = {};
  for (const s of ["orders", "hyperliquid", "trailing", "discord", "bot", "commands"]) {
    const rows: any[] = [];
    for (let i = 0; i < 400; i++) {
      let q = c.from("bot_logs").select("ts,level,message").eq("source", s).gte("ts", "2026-08-20T00:00:00Z").order("ts", { ascending: true }).range(i * 1000, i * 1000 + 999);
      if (s === "commands") q = c.from("bot_logs").select("ts,level,message").eq("source", s).gte("ts", "2026-08-20T00:00:00Z").not("message", "ilike", "%Realtime subscription%").order("ts", { ascending: true }).range(i * 1000, i * 1000 + 999);
      const { data, error } = await q; if (error) throw error; rows.push(...(data ?? [])); if (!data || data.length < 1000) break;
    }
    out[s] = rows; console.log(`${s}: ${rows.length}`);
    const pref = new Map<string, number>(); for (const r of rows) { const k = r.message.replace(/\d/g, "#").slice(0, 40); pref.set(k, (pref.get(k) ?? 0) + 1); }
    for (const [k, v] of [...pref.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${v} ${k}`);
  }
  require("fs").writeFileSync(process.argv[2], JSON.stringify(out));
})().catch(e => { console.error(e); process.exit(1); });
