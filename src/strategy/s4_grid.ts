/**
 * S4 Grid strategy — configuration, types, and helpers.
 *
 * Long-biased grid: buys at lower levels, sells at upper levels.
 * Each cell between adjacent levels is an independent buy-low/sell-high unit.
 *
 * Flash production lessons baked in:
 * - Volatility-adaptive spacing (3 tiers)
 * - Rapid momentum detector (3 buys in 60min = pause)
 * - Sell-only mode during regime/momentum pause
 * - Auto-recenter with daily cap
 */

// ── Config ──────────────────────────────────────────────────────

export interface GridConfig {
  levelsPerSide: number;
  baseSpacingPct: number;
  marginPctPerLevel: number;
  leverage: number;
  volatilityAdaptive: boolean;
  regimeFilter: boolean;
  momentumWindowMs: number;
  momentumThreshold: number;
  recenterBarsThreshold: number;
  recenterDailyCap: number;
  hourlyFundingRate: number;
  feePct: number;
}

export const DEFAULT_GRID_CONFIG: GridConfig = {
  levelsPerSide: 5,
  baseSpacingPct: 0.005,
  marginPctPerLevel: 0.01,
  leverage: 3,
  volatilityAdaptive: true,
  regimeFilter: true,
  momentumWindowMs: 60 * 60_000,
  momentumThreshold: 3,
  recenterBarsThreshold: 5,
  recenterDailyCap: 3,
  hourlyFundingRate: 0.0000125,
  feePct: 0.00045,
};

// ── Types ───────────────────────────────────────────────────────

export interface GridCell {
  bottomPrice: number;
  topPrice: number;
  filled: boolean;
  entryPrice: number;
  entryTime: number;
  sizeBase: number;
  marginUsed: number;
  accFunding: number;
}

export interface GridTrade {
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  sizeBase: number;
  marginUsed: number;
  leverage: number;
  grossPnl: number;
  fees: number;
  funding: number;
  netPnl: number;
  exitReason: "round_trip" | "recenter_close" | "vol_recenter" | "end_of_data";
}

export interface GridStats {
  totalRoundTrips: number;
  avgRoundTripTimeMs: number;
  grossRoundTripPnl: number;
  totalFees: number;
  longFundingPaid: number;
  shortFundingPaid: number;
  recenterLosses: number;
  recenterCount: number;
  netPnl: number;
  netPnlPct: number;
  maxInventory: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  momentumPauses: number;
  regimePauses: number;
  sharpeRatio: number | null;
  winRate: number;
  winners: number;
  losers: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  totalBars: number;
  pausedBars: number;
  gridUptimePct: number;
}

// ── Volatility tiers (from Flash) ───────────────────────────────

export type VolTier = "low" | "normal" | "high";

export function getVolTier(dailyVol: number): VolTier {
  if (dailyVol < 0.01) return "low";
  if (dailyVol <= 0.03) return "normal";
  return "high";
}

export function getSpacingForTier(tier: VolTier): number {
  switch (tier) {
    case "low": return 0.003;
    case "normal": return 0.005;
    case "high": return 0.008;
  }
}

// ── Grid builders ───────────────────────────────────────────────

export function buildGridLevels(
  midPrice: number,
  spacingPct: number,
  levelsPerSide: number,
): number[] {
  const levels: number[] = [];
  for (let i = -levelsPerSide; i <= levelsPerSide; i++) {
    levels.push(midPrice * (1 + spacingPct * i));
  }
  return levels;
}

export function buildCells(levels: number[]): GridCell[] {
  const cells: GridCell[] = [];
  for (let i = 0; i < levels.length - 1; i++) {
    cells.push({
      bottomPrice: levels[i],
      topPrice: levels[i + 1],
      filled: false,
      entryPrice: 0,
      entryTime: 0,
      sizeBase: 0,
      marginUsed: 0,
      accFunding: 0,
    });
  }
  return cells;
}

/**
 * 14-day close-to-close volatility.
 * Returns average absolute daily log return (e.g. 0.02 = 2% avg daily move).
 */
export function computeDailyVol(dailyCloses: number[]): number {
  if (dailyCloses.length < 15) return 0.02;
  const recent = dailyCloses.slice(-14);
  let sum = 0;
  for (let i = 1; i < recent.length; i++) {
    sum += Math.abs(Math.log(recent[i] / recent[i - 1]));
  }
  return sum / (recent.length - 1);
}
