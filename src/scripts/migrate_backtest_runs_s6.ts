/**
 * Migration: add S6 per-strategy columns to backtest_runs.
 *
 * `backtest_runs` was created (migrate_backtest_runs.ts) when the engine only
 * knew S1/S2/S3. S6 has been a live strategy since Session 33 and is half of
 * the current live set, so every stored run silently dropped its attribution.
 *
 * Adds to backtest_runs:
 *   - s6_trades   integer NOT NULL DEFAULT 0
 *   - s6_win_rate numeric NOT NULL DEFAULT 0
 *   - s6_pnl_usd  numeric NOT NULL DEFAULT 0
 *
 * Idempotent — uses ADD COLUMN IF NOT EXISTS.
 *
 * Usage: npx ts-node src/scripts/migrate_backtest_runs_s6.ts
 *
 * There is no exec_sql RPC on this project, so this script will print the SQL
 * for the Supabase SQL Editor rather than applying it.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const migrations = [
    {
      label: "backtest_runs.s6_trades",
      sql: `ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS s6_trades integer NOT NULL DEFAULT 0;`,
    },
    {
      label: "backtest_runs.s6_win_rate",
      sql: `ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS s6_win_rate numeric NOT NULL DEFAULT 0;`,
    },
    {
      label: "backtest_runs.s6_pnl_usd",
      sql: `ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS s6_pnl_usd numeric NOT NULL DEFAULT 0;`,
    },
  ];

  console.log("=== backtest_runs S6 columns migration ===\n");

  let applied = 0;
  for (const m of migrations) {
    console.log(`[Migrate] ${m.label}...`);
    const { error } = await supabase.rpc("exec_sql", { sql: m.sql });
    if (error) {
      console.log(`  ⚠ rpc unavailable (${error.message}) — run manually.`);
    } else {
      console.log("  ✓ Done");
      applied++;
    }
  }

  // Probe the live schema rather than trusting the rpc result.
  const { error: probeErr } = await supabase
    .from("backtest_runs")
    .select("s6_trades,s6_win_rate,s6_pnl_usd")
    .limit(1);

  if (!probeErr) {
    console.log("\n✅ Verified: backtest_runs has the three s6_* columns.");
    return;
  }

  console.log(`\n❌ Columns still missing (${probeErr.message}).`);
  console.log("\n=== Copy into the Supabase SQL Editor ===\n");
  for (const m of migrations) console.log(m.sql);
  console.log(
    "\nhttps://supabase.com/dashboard/project/gseztkzguxasfwqnztuo/sql\n",
  );
  console.log("Then re-run this script to verify.");
  process.exit(1);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
