/**
 * Strategy 6: BBWP Volatility Breakout
 *
 * Timeframe: 4H (primary signal)
 * Style: Trend-following — catches explosive breakouts from compressed volatility
 *
 * Entry: BBWP crosses above 50 after recent compression (<20 within lookback)
 * Direction: Price > EMA21 on 4H = LONG, Price < EMA21 = SHORT
 * Stop: 2% (tighter than S1's 3% — breakouts work immediately or fail)
 * Exit: EMA8/EMA55 reverse cross on 4H, OR BBWP expansion cycle complete (>85 → <35)
 */

import type { Signal, Direction } from "./types";

const S6_STOP_DISTANCE = 0.02;
const COMPRESSION_THRESHOLD = 20;
const EXPANSION_THRESHOLD = 50;
const COMPRESSION_LOOKBACK = 10; // 4H bars (~40 hours)

// ── Module state ────────────────────────────────────────────────

let prevBbwp: number | null = null;
let barsSinceCompression = Infinity;

export function resetS6State(): void {
  prevBbwp = null;
  barsSinceCompression = Infinity;
}

// ── Entry evaluation (call on each new 4H bar) ─────────────────

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

  let signal: Signal | null = null;

  if (
    prevBbwp !== null &&
    prevBbwp < EXPANSION_THRESHOLD &&
    bbwp >= EXPANSION_THRESHOLD &&
    barsSinceCompression <= COMPRESSION_LOOKBACK
  ) {
    const direction: Direction = close > ema21 ? "long" : "short";
    signal = { direction, strategy: "S6", stopDistancePct: S6_STOP_DISTANCE };
  }

  prevBbwp = bbwp;
  return signal;
}

// ── Exit evaluation (call on each new 4H bar while in position) ─

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

  // Exit 2: EMA8/EMA55 reverse cross on 4H (same logic as S1)
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
