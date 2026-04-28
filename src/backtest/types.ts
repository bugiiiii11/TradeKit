/**
 * Shared types for the backtesting engine.
 */

export interface Candle {
  timestamp: number; // bar open time, epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A candle with all indicators computed. */
export interface BarData extends Candle {
  ema8: number;
  ema13: number;
  ema21: number;
  ema55: number;
  ema200: number;
  rsi14: number;
  stochK: number;
  stochD: number;
  bbwp: number;
  pmarp: number;
}

/** One 15m bar aligned with the most recent 1H/4H/1D bar at or before it. */
export interface AlignedBar {
  bar15m: BarData;
  bar1H: BarData;
  bar4H: BarData;
  bar1D: BarData;
}

export type StrategyId = "S1" | "S2" | "S3";
export type Direction = "long" | "short";

/** A position open in the simulated account. */
export interface OpenPosition {
  strategy: StrategyId;
  direction: Direction;
  entryPrice: number;
  entryTimestamp: number; // epoch ms
  leverage: number;
  marginUsd: number;
  notionalUsd: number;
  stopPrice: number;
  stopDistancePct: number;
  /** S3 only: [tp1Price, tp2Price, tp3Price] */
  tpPrices?: [number, number, number];
}

/** One completed trade (one per position close). */
export interface BacktestTrade {
  strategy: StrategyId;
  /** Comma-joined if multiple strategies fired (e.g. "S1,S3") */
  activeStrategies: string;
  direction: Direction;
  entryTimestamp: number;
  entryPrice: number;
  exitTimestamp: number;
  exitPrice: number;
  exitReason: string;
  leverage: number;
  marginUsd: number;
  notionalUsd: number;
  /** Net PnL after fees. */
  pnlUsd: number;
  /** Raw % price move (not leveraged). */
  pnlPct: number;
  /** Risk multiple: pnlUsd / (notionalUsd * stopDistancePct). */
  pnlR: number;
  stopPrice: number;
  /** Funding cost accumulated during hold (positive = cost to longs). */
  fundingPnl: number;
}

export interface BacktestConfig {
  days: number;
  bankroll: number;
  /** Fraction of bankroll used as margin per trade. Default 0.05. */
  marginPct: number;
  /** Which strategies are enabled. Default: all three. */
  enabledStrategies?: StrategyId[];
  /** Enable daily EMA regime filter for S3 entries. */
  regimeFilter?: boolean;
}

/** A signal that was blocked by the regime filter. */
export interface FilteredSignal {
  timestamp: number;
  strategy: StrategyId;
  direction: Direction;
  regime: string;
  price: number;
}

export interface BacktestStats {
  totalTrades: number;
  winners: number;
  losers: number;
  winRate: number;
  totalPnlUsd: number;
  grossWin: number;
  grossLoss: number;
  profitFactor: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  avgWinUsd: number;
  avgLossUsd: number;
  avgRMultiple: number;
  /** Annualised Sharpe. Null if < 10 trades. */
  sharpeRatio: number | null;
  byStrategy: Record<StrategyId, {
    trades: number;
    winRate: number;
    pnlUsd: number;
  }>;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: BacktestTrade[];
  equityCurve: Array<{ timestamp: number; equity: number }>;
  stats: BacktestStats;
  /** Signals blocked by the regime filter (only populated when regimeFilter=true). */
  filteredSignals?: FilteredSignal[];
}
