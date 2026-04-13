/**
 * Bot log sink — batched writer to public.bot_logs.
 *
 * Strategy: monkey-patch console.log/warn/error at startup so every existing
 * console call in the codebase also flows into a ring buffer. A background
 * flush interval drains the buffer into Supabase every FLUSH_INTERVAL_MS. On
 * SIGINT/SIGTERM/beforeExit we flush synchronously (best-effort) so nothing
 * is lost at shutdown.
 *
 * Why monkey-patch instead of a Logger abstraction:
 *   - Zero churn across the ~30 existing console.* call sites in the codebase
 *   - New code can keep using console.* naturally
 *   - The patch is reversible via uninstallLogSink() for tests
 *
 * Graceful: if Supabase is unavailable, initLogSink() is a no-op. The bot
 * continues to log to stdout normally.
 *
 * Source detection: if the first argument is a string starting with "[Xxx]",
 * the source is lowercased "xxx" (e.g. "[Bot] ..." → source "bot"). This
 * matches the existing logging convention across main.ts, reader.ts, mcp
 * client, etc. Default source is "main".
 */

import { format } from "node:util";
import { getSupabase } from "./supabase";

type LogLevel = "info" | "warn" | "error";

interface BufferedLine {
  ts: string;
  level: LogLevel;
  source: string;
  message: string;
}

// Tunables
const FLUSH_INTERVAL_MS = 2000;
const BUFFER_MAX = 200;

// Module state
let installed = false;
let buffer: BufferedLine[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let droppedCount = 0;

// Originals — captured once at install time so we can always reach them.
const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
const origError = console.error.bind(console);

// ---------------------------------------------------------------------------

function detectSource(args: unknown[]): string {
  if (args.length === 0) return "main";
  const first = args[0];
  if (typeof first !== "string") return "main";
  const match = first.match(/^\[([A-Za-z][\w-]*)\]/);
  if (!match) return "main";
  return match[1].toLowerCase();
}

function capture(level: LogLevel, args: unknown[]): void {
  if (buffer.length >= BUFFER_MAX) {
    buffer.shift(); // drop oldest
    droppedCount++;
  }
  buffer.push({
    ts: new Date().toISOString(),
    level,
    source: detectSource(args),
    message: format(...(args as [unknown, ...unknown[]])),
  });
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const client = getSupabase();
  if (!client) {
    // Lost Supabase mid-session — drop the buffer, log to stderr once.
    const count = buffer.length;
    buffer = [];
    origError(`[Logs] Supabase unavailable, dropped ${count} buffered log lines`);
    return;
  }

  // Swap the buffer out so new log lines can accumulate during the flush.
  const toFlush = buffer;
  buffer = [];

  try {
    const { error } = await client.from("bot_logs").insert(toFlush);
    if (error) {
      // Don't re-buffer on error — would create an infinite growth loop if
      // the DB is persistently unhappy. Just report via original stderr so
      // we don't recurse back through the patched console.error.
      origError("[Logs] bot_logs insert error:", error.message);
    }
  } catch (err) {
    origError("[Logs] bot_logs insert threw:", err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Installs the log sink. Safe to call multiple times (only installs once).
 * No-op if Supabase env vars are missing.
 */
export function initLogSink(): void {
  if (installed) return;
  const client = getSupabase();
  if (!client) return; // silent no-op; supabase.ts already warned once

  installed = true;

  // Patch console methods. Each wrapper still calls through to the original
  // so stdout/stderr behavior is preserved.
  console.log = (...args: unknown[]): void => {
    capture("info", args);
    origLog(...args);
  };
  console.warn = (...args: unknown[]): void => {
    capture("warn", args);
    origWarn(...args);
  };
  console.error = (...args: unknown[]): void => {
    capture("error", args);
    origError(...args);
  };

  // Background flush.
  flushTimer = setInterval(() => {
    flush().catch((err) => origError("[Logs] flush loop error:", err));
  }, FLUSH_INTERVAL_MS);
  // Don't block process exit on the flush timer.
  if (typeof flushTimer.unref === "function") flushTimer.unref();

  // Flush on shutdown. We use .catch + process.exit(0) so the flush has a
  // chance to complete before we hand control back.
  const shutdown = (signal: string) => {
    origLog(`[Logs] ${signal} received, flushing log buffer...`);
    flush()
      .catch((err) => origError("[Logs] shutdown flush error:", err))
      .finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("beforeExit", () => {
    // beforeExit is fired when the event loop drains. Attempt a final flush.
    flush().catch((err) => origError("[Logs] beforeExit flush error:", err));
  });

  origLog("[Logs] Supabase log sink installed (flush every 2s, buffer cap 200)");
}

/**
 * Uninstalls the patch — restores original console methods and clears timers.
 * Primarily for tests.
 */
export function uninstallLogSink(): void {
  if (!installed) return;
  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  installed = false;
}

/** Number of log lines dropped due to buffer overflow (mostly a health metric). */
export function getDroppedCount(): number {
  return droppedCount;
}
