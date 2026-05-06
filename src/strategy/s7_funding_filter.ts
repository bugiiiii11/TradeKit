/**
 * S7: Funding Rate Momentum Filter
 *
 * Optional boolean filter for S1/S2 entries. Blocks entries when funding
 * rate velocity opposes the trade direction.
 *
 * Velocity = current_rate - rate_N_bars_ago (positive = crowd going long)
 *
 * LONG blocked when velocity < 0 (crowd exiting longs / going short)
 * SHORT blocked when velocity > 0 (crowd exiting shorts / going long)
 *
 * Enable: S7_FUNDING_FILTER=true in .env (default: disabled)
 */

const LOOKBACK_BARS = 16; // 4 hours at 15m intervals
const MAX_HISTORY = 100;

const fundingHistory: number[] = [];

export function recordFundingRate(rate: number): void {
  fundingHistory.push(rate);
  if (fundingHistory.length > MAX_HISTORY) {
    fundingHistory.shift();
  }
}

export function checkFundingFilter(
  direction: "long" | "short",
): { allowed: boolean; velocity: number; reason: string } {
  if (fundingHistory.length < LOOKBACK_BARS + 1) {
    return { allowed: true, velocity: 0, reason: "warmup" };
  }

  const current = fundingHistory[fundingHistory.length - 1];
  const past = fundingHistory[fundingHistory.length - 1 - LOOKBACK_BARS];
  const velocity = current - past;

  if (direction === "long" && velocity < 0) {
    return { allowed: false, velocity, reason: "funding_opposing" };
  }
  if (direction === "short" && velocity > 0) {
    return { allowed: false, velocity, reason: "funding_opposing" };
  }

  return { allowed: true, velocity, reason: "funding_confirms" };
}
