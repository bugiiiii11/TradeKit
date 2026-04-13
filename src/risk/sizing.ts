/**
 * Position sizing calculator
 *
 * Formula from KB:
 *   position_size = (bankroll × risk_percent) / (entry_price × stop_loss_distance%)
 *   effective_position = position_size × leverage
 *   margin_required = effective_position / leverage
 *
 * Example: $500 bankroll, 3% risk ($15), 1% stop, 5x leverage
 *   position_size = 15 / (entry × 0.01)
 *   If entry = $85,000: position_size = 15 / 850 = 0.01765 BTC → $1,500 notional
 *   margin_required = $1,500 / 5 = $300
 */

export interface SizingResult {
  /** Notional position value in USD */
  positionUsd: number;
  /** Margin to lock up in USD */
  marginUsd: number;
  /** Dollar amount at risk */
  riskDollar: number;
  /** Position size in base asset (BTC) */
  positionBase: number;
}

/**
 * @param bankroll     Current portfolio value in USD
 * @param riskPercent  Fraction of bankroll to risk (e.g. 0.02 = 2%)
 * @param entryPrice   BTC entry price in USD
 * @param stopDistPct  Stop-loss distance as a decimal (e.g. 0.03 = 3%)
 * @param leverage     Leverage multiplier (e.g. 5)
 */
export function calcPositionSize(
  bankroll: number,
  riskPercent: number,
  entryPrice: number,
  stopDistPct: number,
  leverage: number
): SizingResult {
  if (stopDistPct <= 0) throw new Error("stopDistPct must be > 0");
  if (leverage <= 0) throw new Error("leverage must be > 0");

  const riskDollar = bankroll * riskPercent;

  // Notional position size so that the stop-loss equals exactly riskDollar
  const positionUsd = riskDollar / stopDistPct;

  // Margin required at the given leverage
  const marginUsd = positionUsd / leverage;

  // Base asset quantity
  const positionBase = positionUsd / entryPrice;

  return { positionUsd, marginUsd, riskDollar, positionBase };
}
