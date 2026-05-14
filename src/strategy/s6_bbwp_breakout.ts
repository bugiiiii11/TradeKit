/**
 * Strategy 6: BBWP Volatility Breakout
 *
 * Timeframe: 1H (primary signal)
 * Style: Trend-following — catches explosive breakouts from compressed volatility
 *
 * Entry: BBWP crosses above 50 after recent compression (<20 within 40 1H bars)
 * Direction: Price > EMA21 on 1H = LONG, Price < EMA21 = SHORT
 * Stop: 2% (tighter than S1's 3% — breakouts work immediately or fail)
 * Exit: EMA8/EMA55 reverse cross on 1H, OR BBWP expansion cycle complete (>85 → <35)
 */

import type { Signal, Direction } from "./types";
import { sendDiscord, Colors } from "../notifications/discord";

const S6_STOP_DISTANCE = 0.02;
const COMPRESSION_THRESHOLD = 20;
const EXPANSION_THRESHOLD = 50;
let compressionLookback = 40; // 1H bars (~40 hours)

export function setS6Lookback(n: number): void { compressionLookback = n; }

// ── Module state ────────────────────────────────────────────────

let prevBbwp: number | null = null;
let barsSinceCompression = Infinity;

export function resetS6State(): void {
  prevBbwp = null;
  barsSinceCompression = Infinity;
}

export function seedS6Compression(bbwpHistory: number[]): void {
  barsSinceCompression = Infinity;
  for (const bbwp of bbwpHistory) {
    if (bbwp < COMPRESSION_THRESHOLD) {
      barsSinceCompression = 0;
    } else {
      barsSinceCompression++;
    }
  }
  if (bbwpHistory.length > 0) {
    prevBbwp = bbwpHistory[bbwpHistory.length - 1];
  }
  console.log(
    `[S6] Compression counter seeded from ${bbwpHistory.length} historical 1H bars — ` +
    `barsSinceCompression=${barsSinceCompression === Infinity ? "never" : barsSinceCompression}`
  );
}

// ── Entry evaluation (call on each new 1H bar) ─────────────────

export interface S6Snapshot {
  bbwp: number;
  close: number;
  ema21: number;
}

export function evaluateS6(snap: S6Snapshot): Signal | null {
  const { bbwp, close, ema21 } = snap;

  if (bbwp < COMPRESSION_THRESHOLD) {
    barsSinceCompression = 0;
  } else {
    barsSinceCompression++;
  }

  const crossUp = prevBbwp !== null && prevBbwp < EXPANSION_THRESHOLD && bbwp >= EXPANSION_THRESHOLD;
  const recentCompression = barsSinceCompression <= compressionLookback;

  const diagMsg =
    `BBWP=${bbwp.toFixed(1)} prev=${prevBbwp?.toFixed(1) ?? "—"} ` +
    `cross50=${crossUp ? "YES" : "no"} ` +
    `compress=${recentCompression ? `${barsSinceCompression}bars(ok)` : `${barsSinceCompression === Infinity ? "never" : barsSinceCompression + "bars"}(FAIL)`} ` +
    `EMA21=${close > ema21 ? "above(long)" : "below(short)"}`;
  console.log(`[S6-diag] ${diagMsg}`);
  sendDiscord("signals", `S6 Hourly Eval\n${diagMsg}`, Colors.blue);

  let signal: Signal | null = null;

  if (crossUp && recentCompression) {
    const direction: Direction = close > ema21 ? "long" : "short";
    signal = { direction, strategy: "S6", stopDistancePct: S6_STOP_DISTANCE };
    console.log(`[S6-diag] >>> SIGNAL: ${direction.toUpperCase()}`);
  }

  prevBbwp = bbwp;
  return signal;
}

// ── Exit evaluation (call on each new 1H bar while in position) ─

export interface S6ExitSnapshot {
  bbwp: number;
  ema8: number;
  ema55: number;
}

let prevEma8Above55: boolean | null = null;
let peakBbwp = 0;

export function resetS6ExitState(): void {
  prevEma8Above55 = null;
  peakBbwp = 0;
}

export function shouldExitS6(
  snap: S6ExitSnapshot,
  direction: Direction,
): { exit: boolean; reason: string } {
  const { bbwp, ema8, ema55 } = snap;

  if (bbwp > 85) peakBbwp = bbwp;

  // Exit 1: expansion cycle complete (BBWP went >85, now dropped <35)
  if (peakBbwp > 85 && bbwp < 35) {
    return { exit: true, reason: "bbwp_cycle_complete" };
  }

  // Exit 2: EMA8/EMA55 reverse cross on 1H (same logic as S1)
  const isAbove = ema8 > ema55;
  if (prevEma8Above55 !== null) {
    if (direction === "long" && prevEma8Above55 && !isAbove) {
      prevEma8Above55 = isAbove;
      return { exit: true, reason: "ema_reverse_cross" };
    }
    if (direction === "short" && !prevEma8Above55 && isAbove) {
      prevEma8Above55 = isAbove;
      return { exit: true, reason: "ema_reverse_cross" };
    }
  }
  prevEma8Above55 = isAbove;

  return { exit: false, reason: "" };
}

export { S6_STOP_DISTANCE };
