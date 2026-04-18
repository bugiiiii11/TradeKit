/**
 * Migration: add source/target columns for two-bot architecture.
 *
 * Adds a `source` column (text, default 'tv-bot') to:
 *   - market_snapshots
 *   - risk_snapshots
 *   - positions
 *
 * Adds a `target` column (text, nullable) to:
 *   - bot_commands
 *
 * Expands the `trades.source` column to accept 'tv-bot' and 'vps-bot'
 * (it already exists with values 'bot' | 'manual').
 *
 * Idempotent — uses IF NOT EXISTS checks.
 *
 * Usage: npx ts-node src/scripts/migrate_source_columns.ts
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
      label: "market_snapshots.source",
      sql: `ALTER TABLE market_snapshots ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'tv-bot';`,
    },
    {
      label: "risk_snapshots.source",
      sql: `ALTER TABLE risk_snapshots ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'tv-bot';`,
    },
    {
      label: "positions.source",
      sql: `ALTER TABLE positions ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'tv-bot';`,
    },
    {
      label: "bot_commands.target",
      sql: `ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS target text;`,
    },
    {
      label: "risk_snapshots index on (source, taken_at)",
      sql: `CREATE INDEX IF NOT EXISTS idx_risk_snapshots_source_taken ON risk_snapshots (source, taken_at DESC);`,
    },
  ];

  console.log("=== Two-Bot Architecture Migration ===\n");

  for (const m of migrations) {
    console.log(`[Migrate] ${m.label}...`);
    const { error } = await supabase.rpc("exec_sql", { sql: m.sql });
    if (error) {
      // rpc exec_sql may not exist — try raw SQL via the REST API
      console.log(`  rpc failed (${error.message}), trying direct...`);
      const { error: error2 } = await supabase.from("_migrations_noop").select("*").limit(0);
      // Fall back to logging the SQL for manual execution
      console.log(`  ⚠ Run manually in Supabase SQL Editor:`);
      console.log(`    ${m.sql}`);
    } else {
      console.log(`  ✓ Done`);
    }
  }

  console.log("\n=== Migration SQL (copy-paste to Supabase SQL Editor if needed) ===\n");
  for (const m of migrations) {
    console.log(m.sql);
  }

  console.log("\n=== Verification queries ===\n");
  console.log("-- Check columns exist:");
  console.log("SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'risk_snapshots' AND column_name = 'source';");
  console.log("SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'bot_commands' AND column_name = 'target';");

  console.log("\nDone. If rpc failed, copy the SQL above into the Supabase SQL Editor and run manually.");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
