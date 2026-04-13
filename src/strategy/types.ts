export type Direction = "long" | "short";
export type StrategyId = "S1" | "S2" | "S3";

export interface Signal {
  direction: Direction;
  strategy: StrategyId;
  /** Stop-loss distance as a decimal (e.g. 0.02 = 2%) */
  stopDistancePct: number;
}

export interface ConfluenceResult {
  /** Confluence score out of 10 */
  score: number;
  direction: Direction | null;
  /** Recommended leverage based on confluence table */
  leverage: number;
  /** Risk percent of bankroll for this trade (2% default, 5% high-conviction) */
  riskPercent: number;
  signals: Signal[];
}
