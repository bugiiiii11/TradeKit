/**
 * S5: Cascade Signal Overlay
 *
 * SHORT-only entry triggered by DeFi liquidation cascades detected by Flash.
 * Signal arrives via webhook POST, evaluated on next bar close.
 *
 * Entry: cascade severity >= threshold + signal fresh (< SIGNAL_TTL_MS)
 * Direction: always SHORT (cascades push prices down)
 * Stop: 4% (wider than S6 — cascades are volatile before resolving)
 * Exit: time-based (MAX_HOLD_MS) or BBWP > 85 (extreme vol reached)
 * Bypasses confluence (independent entry, like S6)
 */

export const S5_STOP_DISTANCE = 0.04;
const SIGNAL_TTL_MS = 30 * 60 * 1000; // 30 minutes — signal must be acted on quickly
const MAX_HOLD_MS = 8 * 60 * 60 * 1000; // 8 hours

export type CascadeSeverity = "medium" | "high" | "critical";

export interface CascadeSignal {
  severity: CascadeSeverity;
  estimatedImpactUsd: number;
  chains: string[];
  imminentCount: number;
  aggregateDebtUsd: number;
  receivedAt: number; // epoch ms (when TradeKit received it)
  sourceTimestamp?: string; // when Flash detected it
}

const SEVERITY_THRESHOLD: Record<CascadeSeverity, number> = {
  medium: 1,
  high: 2,
  critical: 3,
};

const MIN_SEVERITY: CascadeSeverity = "high";

let pendingSignal: CascadeSignal | null = null;

export function receiveCascadeSignal(signal: CascadeSignal): void {
  pendingSignal = signal;
}

export function getPendingSignal(): CascadeSignal | null {
  return pendingSignal;
}

export function clearPendingSignal(): void {
  pendingSignal = null;
}

export function evaluateS5(): { direction: "short"; stopDistancePct: number } | null {
  if (!pendingSignal) return null;

  const age = Date.now() - pendingSignal.receivedAt;
  if (age > SIGNAL_TTL_MS) {
    pendingSignal = null;
    return null;
  }

  if (SEVERITY_THRESHOLD[pendingSignal.severity] < SEVERITY_THRESHOLD[MIN_SEVERITY]) {
    return null;
  }

  pendingSignal = null;
  return { direction: "short", stopDistancePct: S5_STOP_DISTANCE };
}

export function shouldExitS5(
  entryTimestamp: string,
  bbwp: number,
): { exit: boolean; reason: string } {
  const holdMs = Date.now() - new Date(entryTimestamp).getTime();

  if (holdMs >= MAX_HOLD_MS) {
    return { exit: true, reason: "s5_max_hold" };
  }

  if (bbwp > 85) {
    return { exit: true, reason: "s5_extreme_vol" };
  }

  return { exit: false, reason: "" };
}
