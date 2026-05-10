/**
 * Unit test: trailing stop-loss (breakeven mode) math
 *
 * Pure function tests — no exchange calls, no .env needed.
 * Run: npx ts-node src/scripts/test_trailing.ts
 */

import { evaluateTrailing, TrailingInput } from "../risk/trailing";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function baseInput(overrides: Partial<TrailingInput> = {}): TrailingInput {
  return {
    direction: "long",
    entryPrice: 100000,
    currentStopPrice: 97000,  // 3% below entry
    markPrice: 100000,
    trailingMode: "breakeven",
    breakevenApplied: false,
    activationDistance: 0.02,  // 2%
    breakevenBuffer: 0.001,   // 0.1%
    ...overrides,
  };
}

console.log("\n=== Trailing Stop-Loss Unit Tests ===\n");

// --- Mode: off ---
console.log("Mode: off");
{
  const r = evaluateTrailing(baseInput({ trailingMode: "off" }));
  assert(!r.shouldMove, "should not move when mode=off");
  assert(r.reason === "trailing_off", "reason is trailing_off");
}

// --- Mode: breakeven, price hasn't moved enough ---
console.log("\nBreakeven: below activation threshold");
{
  // Price at +1% (below 2% threshold)
  const r = evaluateTrailing(baseInput({ markPrice: 101000 }));
  assert(!r.shouldMove, "should not move at +1% (threshold is 2%)");
  assert(r.reason === "below_activation_threshold", "reason is below_activation_threshold");
}

// --- Mode: breakeven, price at exactly 2% ---
console.log("\nBreakeven: at activation threshold (long)");
{
  const r = evaluateTrailing(baseInput({ markPrice: 102000 }));
  assert(r.shouldMove, "should move at +2%");
  assert(r.newStopPrice !== null, "newStopPrice is set");
  // Expected: entry * 1.001 = 100100
  assert(Math.abs(r.newStopPrice! - 100100) < 1, `new SL = $${r.newStopPrice!.toFixed(1)} (expected ~$100100)`);
  assert(r.reason === "breakeven_activated", "reason is breakeven_activated");
}

// --- Mode: breakeven, price well above threshold ---
console.log("\nBreakeven: well above threshold (long +5%)");
{
  const r = evaluateTrailing(baseInput({ markPrice: 105000 }));
  assert(r.shouldMove, "should move at +5%");
  assert(Math.abs(r.newStopPrice! - 100100) < 1, `new SL = $${r.newStopPrice!.toFixed(1)} (still entry+buffer)`);
}

// --- Mode: breakeven, already applied ---
console.log("\nBreakeven: already applied");
{
  const r = evaluateTrailing(baseInput({
    markPrice: 105000,
    breakevenApplied: true,
  }));
  assert(!r.shouldMove, "should not move when already applied");
  assert(r.reason === "breakeven_already_applied", "reason is breakeven_already_applied");
}

// --- Mode: breakeven, current SL already better than breakeven ---
console.log("\nBreakeven: current SL already better");
{
  const r = evaluateTrailing(baseInput({
    markPrice: 103000,
    currentStopPrice: 100200, // already above entry+buffer
  }));
  assert(!r.shouldMove, "should not move when current SL is already better");
  assert(r.reason === "current_sl_already_better", "reason is current_sl_already_better");
}

// --- SHORT direction tests ---
console.log("\nBreakeven: short — below activation threshold");
{
  // Short at $100k, mark at $99k (+1% in our favor)
  const r = evaluateTrailing(baseInput({
    direction: "short",
    entryPrice: 100000,
    currentStopPrice: 103000, // 3% above entry
    markPrice: 99000,
  }));
  assert(!r.shouldMove, "short: should not move at +1%");
}

console.log("\nBreakeven: short — at activation threshold");
{
  // Short at $100k, mark at $98k (+2% in our favor)
  const r = evaluateTrailing(baseInput({
    direction: "short",
    entryPrice: 100000,
    currentStopPrice: 103000,
    markPrice: 98000,
  }));
  assert(r.shouldMove, "short: should move at +2%");
  // Expected: entry * (1 - 0.001) = 99900
  assert(Math.abs(r.newStopPrice! - 99900) < 1, `short new SL = $${r.newStopPrice!.toFixed(1)} (expected ~$99900)`);
  assert(r.reason === "breakeven_activated", "reason is breakeven_activated");
}

console.log("\nBreakeven: short — current SL already better");
{
  const r = evaluateTrailing(baseInput({
    direction: "short",
    entryPrice: 100000,
    currentStopPrice: 99800, // already below entry-buffer
    markPrice: 97000,
  }));
  assert(!r.shouldMove, "short: should not move when SL already better");
}

// --- Edge: trailing mode (not implemented) ---
console.log("\nTrailing mode: not implemented");
{
  const r = evaluateTrailing(baseInput({ trailingMode: "trailing" }));
  assert(!r.shouldMove, "trailing mode returns no-op");
  assert(r.reason === "trailing_mode_not_implemented", "reason is trailing_mode_not_implemented");
}

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
