/**
 * Risk state tracker
 *
 * Maintains in-memory state for:
 * - Daily PnL (reset at UTC midnight)
 * - Weekly PnL (reset at UTC Monday midnight)
 * - Consecutive loss counter
 * - Open position count
 * - Total portfolio exposure in USD
 * - Pause timers (after loss limits triggered)
 */

export interface RiskState {
  /** Starting bankroll for the day (set on first trade of day) */
  dailyStartBankroll: number;
  /** Running daily PnL in USD */
  dailyPnl: number;
  /** Running weekly PnL in USD */
  weeklyPnl: number;
  /** Date string "YYYY-MM-DD" of last daily reset */
  lastDailyReset: string;
  /** ISO week string "YYYY-Www" of last weekly reset */
  lastWeeklyReset: string;
  /** Number of consecutive losing trades */
  consecutiveLosses: number;
  /** Timestamp (ms) when trading is paused until */
  pausedUntil: number;
  /** Number of currently open positions */
  openPositions: number;
  /** Total margin currently in use (USD) */
  totalExposureUsd: number;
  /** Current bankroll in USD */
  bankroll: number;
  /**
   * Kill switch flag. When true, the bot blocks all new entries AND skips
   * strategy exit evaluation until an explicit resume command is received.
   * Set by the `kill_switch` command handler, cleared by the `resume` handler.
   * Distinct from `pausedUntil` — kill is an unbounded manual stop, pause is
   * a time-bounded automatic drawdown response.
   */
  killed: boolean;
  /** Human-readable reason the kill switch was activated (if any) */
  killedReason: string | null;
}

const initialState = (): RiskState => ({
  dailyStartBankroll: 0,
  dailyPnl: 0,
  weeklyPnl: 0,
  lastDailyReset: "",
  lastWeeklyReset: "",
  consecutiveLosses: 0,
  pausedUntil: 0,
  openPositions: 0,
  totalExposureUsd: 0,
  bankroll: parseFloat(process.env.BANKROLL ?? "500"),
  killed: false,
  killedReason: null,
});

let _state: RiskState = initialState();

export function getState(): Readonly<RiskState> {
  return _state;
}

/** Call when bot starts or bankroll is updated from Drift account */
export function setBankroll(usd: number): void {
  _state.bankroll = usd;
}

/** Call after each trade closes with the PnL result */
export function recordTradeResult(pnlUsd: number, marginUsd: number): void {
  checkAndResetPeriods();

  _state.dailyPnl += pnlUsd;
  _state.weeklyPnl += pnlUsd;
  _state.bankroll += pnlUsd;
  _state.openPositions = Math.max(0, _state.openPositions - 1);
  _state.totalExposureUsd = Math.max(0, _state.totalExposureUsd - marginUsd);

  if (pnlUsd < 0) {
    _state.consecutiveLosses += 1;
  } else {
    _state.consecutiveLosses = 0;
  }
}

/** Call when a new trade is opened */
export function recordTradeOpen(marginUsd: number): void {
  _state.openPositions += 1;
  _state.totalExposureUsd += marginUsd;
}

/** Trigger a trading pause (milliseconds) */
export function triggerPause(durationMs: number): void {
  _state.pausedUntil = Date.now() + durationMs;
}

/**
 * Activate the kill switch. Blocks all new entries and exit evaluation
 * until `clearKilled()` is called. Also zeroes live exposure counters
 * because the kill switch handler closes all positions as part of its
 * work — leaving stale counters would cause subsequent canTrade() calls
 * to misreport exposure after a resume.
 */
export function setKilled(reason: string): void {
  _state.killed = true;
  _state.killedReason = reason;
  _state.openPositions = 0;
  _state.totalExposureUsd = 0;
}

/** Reset consecutive loss counter (called after pause is triggered). */
export function resetConsecutiveLosses(): void {
  _state.consecutiveLosses = 0;
}

/** Deactivate the kill switch so the bot resumes normal evaluation. */
export function clearKilled(): void {
  _state.killed = false;
  _state.killedReason = null;
}

/** Reset state entirely (for testing or restart) */
export function resetState(): void {
  _state = initialState();
}

/**
 * Input shape for hydrating risk state on bot startup. Mirrors the
 * subset of RiskState persisted to `risk_snapshots`. See
 * `db/snapshots.ts:HydratedRiskState` for the loader side.
 */
export interface RiskStateHydration {
  bankroll: number;
  dailyPnl: number;
  weeklyPnl: number;
  dailyStartBankroll: number;
  consecutiveLosses: number;
  pausedUntil: number;
  killed: boolean;
  killedReason: string | null;
  /** ISO timestamp of the source snapshot — used to derive reset keys. */
  takenAt: string;
}

/**
 * Restore state from a persisted snapshot. Called once on bot startup
 * from main.ts, before the command bus subscription and first loop tick.
 *
 * Period-reset logic: if the source snapshot was from a different UTC
 * day than "now", dailyPnl and dailyStartBankroll are zeroed and
 * lastDailyReset is advanced to today — we're starting a fresh day.
 * Same for ISO week / weeklyPnl. This mirrors checkAndResetPeriods()
 * but runs even when no trades have closed.
 *
 * `pausedUntil` timestamps in the past are clamped to 0 so an expired
 * auto-pause doesn't linger across restarts.
 *
 * `totalExposureUsd` and `openPositions` are NOT hydrated — they're
 * authoritative from Hyperliquid and get refreshed by the first loop
 * tick's balance/position sync.
 */
export function hydrateState(h: RiskStateHydration): void {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekStr = getISOWeek(now);

  const source = new Date(h.takenAt);
  const sourceDayStr = source.toISOString().slice(0, 10);
  const sourceWeekStr = getISOWeek(source);

  const sameDay = sourceDayStr === todayStr;
  const sameWeek = sourceWeekStr === weekStr;

  _state = {
    bankroll: h.bankroll,
    // Daily state survives only if we restarted within the same UTC day.
    // Cross-midnight restart → fresh daily budget.
    dailyPnl: sameDay ? h.dailyPnl : 0,
    dailyStartBankroll: sameDay ? h.dailyStartBankroll : 0,
    lastDailyReset: sameDay ? sourceDayStr : todayStr,
    // Weekly state survives the week.
    weeklyPnl: sameWeek ? h.weeklyPnl : 0,
    lastWeeklyReset: sameWeek ? sourceWeekStr : weekStr,
    // Loss streak carries over, but if the counter is at/above the pause
    // threshold and the pause already expired, the cool-off was served —
    // reset so canTrade() doesn't re-trigger on the first signal.
    consecutiveLosses: (h.consecutiveLosses >= 3 && h.pausedUntil <= Date.now()) ? 0 : h.consecutiveLosses,
    // Expired pauses don't linger after restart.
    pausedUntil: h.pausedUntil > Date.now() ? h.pausedUntil : 0,
    // Kill switch persists — a manual kill should survive a crash/restart.
    killed: h.killed,
    killedReason: h.killedReason,
    // These are always refreshed from Hyperliquid / live account on the
    // first tick, so start at zero.
    openPositions: 0,
    totalExposureUsd: 0,
  };
}

// ---------------------------------------------------------------------------

function checkAndResetPeriods(): void {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10); // "YYYY-MM-DD"
  const weekStr = getISOWeek(now);

  if (_state.lastDailyReset !== todayStr) {
    _state.dailyPnl = 0;
    _state.dailyStartBankroll = _state.bankroll;
    _state.lastDailyReset = todayStr;
  }

  if (_state.lastWeeklyReset !== weekStr) {
    _state.weeklyPnl = 0;
    _state.lastWeeklyReset = weekStr;
  }
}

function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
