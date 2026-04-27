/**
 * Risk manager
 *
 * Enforces all portfolio-level limits from the strategy KB:
 *
 *   Max concurrent open positions: 3
 *   Max total portfolio exposure:  60% of bankroll at risk
 *   Daily drawdown limit:          10% → pause 24h
 *   Weekly drawdown limit:         15% → pause 48h
 *   Consecutive loss limit:         3  → pause 4h, review
 */

import { getState, triggerPause, resetConsecutiveLosses } from "./state";
import { SizingResult } from "./sizing";

// TEMP week-1 LIVE cap — was 3 per KB. Restore after first week of LIVE.
const MAX_OPEN_POSITIONS = 3;
const MAX_EXPOSURE_PCT = 0.60;
const DAILY_DRAWDOWN_LIMIT = 0.10;
const WEEKLY_DRAWDOWN_LIMIT = 0.15;
const CONSECUTIVE_LOSS_LIMIT = 3;

const PAUSE_DAILY_MS = 24 * 60 * 60 * 1000;
const PAUSE_WEEKLY_MS = 48 * 60 * 60 * 1000;
const PAUSE_CONSECUTIVE_MS = 4 * 60 * 60 * 1000;

export interface TradePermission {
  allowed: boolean;
  reason?: string;
}

/**
 * Main gate — call before placing any order.
 * Also triggers pause timers when limits are breached.
 *
 * @param sizing  The sizing result for the proposed trade
 */
export function canTrade(sizing: SizingResult): TradePermission {
  const state = getState();
  const now = Date.now();

  // Kill switch — highest-priority gate. Set via the `kill_switch` command
  // and cleared only by an explicit `resume` command. Distinct from
  // `pausedUntil` which is a time-bounded auto-pause.
  if (state.killed) {
    return {
      allowed: false,
      reason: `Killed${state.killedReason ? `: ${state.killedReason}` : ""}`,
    };
  }

  // Check active pause
  if (state.pausedUntil > now) {
    const minLeft = Math.ceil((state.pausedUntil - now) / 60000);
    return { allowed: false, reason: `Trading paused — ${minLeft} minutes remaining` };
  }

  // Open position limit
  if (state.openPositions >= MAX_OPEN_POSITIONS) {
    return { allowed: false, reason: `Max open positions reached (${MAX_OPEN_POSITIONS})` };
  }

  // Total exposure limit
  const maxExposureUsd = state.bankroll * MAX_EXPOSURE_PCT;
  if (state.totalExposureUsd + sizing.marginUsd > maxExposureUsd) {
    return {
      allowed: false,
      reason: `Exposure limit: adding $${sizing.marginUsd.toFixed(2)} would exceed 60% of bankroll`,
    };
  }

  // Daily drawdown limit
  if (state.dailyStartBankroll > 0) {
    const dailyDrawdownPct = -state.dailyPnl / state.dailyStartBankroll;
    if (dailyDrawdownPct >= DAILY_DRAWDOWN_LIMIT) {
      triggerPause(PAUSE_DAILY_MS);
      return {
        allowed: false,
        reason: `Daily drawdown limit hit (${(dailyDrawdownPct * 100).toFixed(1)}%) — pausing 24h`,
      };
    }
  }

  // Weekly drawdown limit
  const weeklyDrawdownPct = state.weeklyPnl < 0
    ? -state.weeklyPnl / state.bankroll
    : 0;
  if (weeklyDrawdownPct >= WEEKLY_DRAWDOWN_LIMIT) {
    triggerPause(PAUSE_WEEKLY_MS);
    return {
      allowed: false,
      reason: `Weekly drawdown limit hit (${(weeklyDrawdownPct * 100).toFixed(1)}%) — pausing 48h`,
    };
  }

  // Consecutive loss limit — pause once, then reset counter so the bot
  // resumes after the cool-off period instead of looping forever.
  if (state.consecutiveLosses >= CONSECUTIVE_LOSS_LIMIT) {
    triggerPause(PAUSE_CONSECUTIVE_MS);
    resetConsecutiveLosses();
    return {
      allowed: false,
      reason: `${CONSECUTIVE_LOSS_LIMIT} consecutive losses — pausing 4h for review`,
    };
  }

  return { allowed: true };
}
