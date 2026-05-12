/**
 * Trailing stop-loss logic (breakeven + trailing modes).
 *
 * Pure function — no exchange calls. Returns the new SL price if a move
 * is warranted, or null if no action needed.
 */

export type TrailingMode = "off" | "breakeven" | "trailing";

export interface TrailingInput {
  direction: "long" | "short";
  entryPrice: number;
  currentStopPrice: number;
  markPrice: number;
  trailingMode: TrailingMode;
  breakevenApplied: boolean;
  activationDistance: number; // e.g. 0.02 = 2% — price must move this far before breakeven activates
  breakevenBuffer: number;   // e.g. 0.001 = 0.1% — buffer above/below entry to avoid spread stops
}

export interface TrailingResult {
  shouldMove: boolean;
  newStopPrice: number | null;
  reason: string;
}

export function evaluateTrailing(input: TrailingInput): TrailingResult {
  const { direction, entryPrice, currentStopPrice, markPrice, trailingMode, breakevenApplied, activationDistance, breakevenBuffer } = input;

  if (trailingMode === "off") {
    return { shouldMove: false, newStopPrice: null, reason: "trailing_off" };
  }

  if (trailingMode === "breakeven") {
    if (breakevenApplied) {
      return { shouldMove: false, newStopPrice: null, reason: "breakeven_already_applied" };
    }

    const priceMoveFromEntry = direction === "long"
      ? (markPrice - entryPrice) / entryPrice
      : (entryPrice - markPrice) / entryPrice;

    if (priceMoveFromEntry < activationDistance) {
      return { shouldMove: false, newStopPrice: null, reason: "below_activation_threshold" };
    }

    // Activation threshold met — move SL to entry + buffer
    const newStop = direction === "long"
      ? entryPrice * (1 + breakevenBuffer)
      : entryPrice * (1 - breakevenBuffer);

    // Only move if new stop is more favorable than current
    const isMoreFavorable = direction === "long"
      ? newStop > currentStopPrice
      : newStop < currentStopPrice;

    if (!isMoreFavorable) {
      return { shouldMove: false, newStopPrice: null, reason: "current_sl_already_better" };
    }

    return { shouldMove: true, newStopPrice: newStop, reason: "breakeven_activated" };
  }

  if (trailingMode === "trailing") {
    const newStop = direction === "long"
      ? markPrice * (1 - activationDistance)
      : markPrice * (1 + activationDistance);

    const isMoreFavorable = direction === "long"
      ? newStop > currentStopPrice
      : newStop < currentStopPrice;

    if (!isMoreFavorable) {
      return { shouldMove: false, newStopPrice: null, reason: "trailing_no_improvement" };
    }

    return { shouldMove: true, newStopPrice: newStop, reason: "trailing_updated" };
  }

  return { shouldMove: false, newStopPrice: null, reason: "unknown_mode" };
}
