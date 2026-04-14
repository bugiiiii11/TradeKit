/**
 * Migration: create backtest_runs table in Supabase.
 *
 * Usage:
 *   npx ts-node src/scripts/migrate_backtest_runs.ts
 *
 * Idempotent — uses CREATE TABLE IF NOT EXISTS.
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

  const sql = `
    CREATE TABLE IF NOT EXISTS backtest_runs (
      id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      created_at    timestamptz DEFAULT now() NOT NULL,
      days          integer NOT NULL,
      bankroll      numeric NOT NULL,
      margin_pct    numeric NOT NULL,
      total_trades  integer NOT NULL,
      winners       integer NOT NULL,
      losers        integer NOT NULL,
      win_rate      numeric NOT NULL,
      total_pnl_usd numeric NOT NULL,
      gross_win     numeric NOT NULL,
      gross_loss    numeric NOT NULL,
      profit_factor numeric NOT NULL,
      max_dd_usd    numeric NOT NULL,
      max_dd_pct    numeric NOT NULL,
      avg_win_usd   numeric NOT NULL,
      avg_loss_usd  numeric NOT NULL,
      avg_r_multiple numeric NOT NULL,
      sharpe_ratio  numeric,
      s1_trades     integer NOT NULL DEFAULT 0,
      s1_win_rate   numeric NOT NULL DEFAULT 0,
      s1_pnl_usd   numeric NOT NULL DEFAULT 0,
      s2_trades     integer NOT NULL DEFAULT 0,
      s2_win_rate   numeric NOT NULL DEFAULT 0,
      s2_pnl_usd   numeric NOT NULL DEFAULT 0,
      s3_trades     integer NOT NULL DEFAULT 0,
      s3_win_rate   numeric NOT NULL DEFAULT 0,
      s3_pnl_usd   numeric NOT NULL DEFAULT 0,
      trades        jsonb NOT NULL DEFAULT '[]',
      equity_curve  jsonb NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_backtest_runs_created_at
      ON backtest_runs (created_at DESC);
  `;

  const { error } = await supabase.rpc("exec_sql", { sql_text: sql });

  if (error) {
    // rpc exec_sql may not exist — fall back to raw REST
    // Try using the Supabase SQL editor approach via postgrest
    console.warn("[Migration] rpc exec_sql not available, trying direct query...");

    // Use the pg module via supabase's direct connection if available
    // For now, output the SQL for manual execution
    console.log("\n[Migration] Please run this SQL in the Supabase SQL Editor:\n");
    console.log(sql);
    console.log("\n[Migration] URL: https://supabase.com/dashboard/project/gseztkzguxasfwqnztuo/sql\n");
    process.exit(1);
  }

  console.log("[Migration] ✅ backtest_runs table created successfully");
}

main().catch(err => {
  console.error("[Migration] ❌ FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
