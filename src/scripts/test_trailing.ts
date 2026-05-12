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

// --- Mode: trailing (continuous) ---
console.log("\nTrailing: long — price moved up, SL should trail");
{
  // Entry $100k, current SL $97k, mark $104k → newStop = $104k * 0.98 = $101,920
  const r = evaluateTrailing(baseInput({
    trailingMode: "trailing",
    markPrice: 104000,
  }));
  assert(r.shouldMove, "trailing: should move when new SL > current SL");
  assert(Math.abs(r.newStopPrice! - 101920) < 1, `trailing new SL = $${r.newStopPrice!.toFixed(1)} (expected ~$101920)`);
  assert(r.reason === "trailing_updated", "reason is trailing_updated");
}

console.log("\nTrailing: long — price at entry, SL stays (ratchet)");
{
  // Entry $100k, current SL $97k, mark $100k → newStop = $100k * 0.98 = $98k → $98k > $97k, should move
  const r = evaluateTrailing(baseInput({
    trailingMode: "trailing",
    markPrice: 100000,
  }));
  assert(r.shouldMove, "trailing: $98k > $97k, should move up");
  assert(Math.abs(r.newStopPrice! - 98000) < 1, `trailing new SL = $${r.newStopPrice!.toFixed(1)} (expected ~$98000)`);
}

console.log("\nTrailing: long — price dropped, ratchet holds");
{
  // Current SL already at $101k (from previous trail), mark dropped to $102k → newStop = $99,960
  // $99,960 < $101k → no improvement
  const r = evaluateTrailing(baseInput({
    trailingMode: "trailing",
    currentStopPrice: 101000,
    markPrice: 102000,
  }));
  assert(!r.shouldMove, "trailing: ratchet prevents SL from moving down");
  assert(r.reason === "trailing_no_improvement", "reason is trailing_no_improvement");
}

console.log("\nTrailing: long — price barely above SL math, no improvement");
{
  // Current SL $97k, mark $98k → newStop = $98k * 0.98 = $96,040 < $97k → no improvement
  const r = evaluateTrailing(baseInput({
    trailingMode: "trailing",
    markPrice: 98000,
  }));
  assert(!r.shouldMove, "trailing: new SL worse than current");
  assert(r.reason === "trailing_no_improvement", "reason is trailing_no_improvement");
}

console.log("\nTrailing: short — price moved down, SL should trail");
{
  // Short entry $100k, current SL $103k, mark $95k → newStop = $95k * 1.02 = $96,900
  // $96,900 < $103k → more favorable for short
  const r = evaluateTrailing(baseInput({
    trailingMode: "trailing",
    direction: "short",
    currentStopPrice: 103000,
    markPrice: 95000,
  }));
  assert(r.shouldMove, "trailing short: should move when new SL < current SL");
  assert(Math.abs(r.newStopPrice! - 96900) < 1, `trailing short new SL = $${r.newStopPrice!.toFixed(1)} (expected ~$96900)`);
  assert(r.reason === "trailing_updated", "reason is trailing_updated");
}

console.log("\nTrailing: short — price moved up, ratchet holds");
{
  // Short, current SL already trailed to $97k, mark bounced to $99k → newStop = $99k * 1.02 = $100,980
  // $100,980 > $97k → worse for short
  const r = evaluateTrailing(baseInput({
    trailingMode: "trailing",
    direction: "short",
    currentStopPrice: 97000,
    markPrice: 99000,
  }));
  assert(!r.shouldMove, "trailing short: ratchet prevents SL from moving up");
  assert(r.reason === "trailing_no_improvement", "reason is trailing_no_improvement");
}

console.log("\nTrailing: short — at entry, SL improves");
{
  // Short entry $100k, current SL $103k, mark $100k → newStop = $102k < $103k → improve
  const r = evaluateTrailing(baseInput({
    trailingMode: "trailing",
    direction: "short",
    currentStopPrice: 103000,
    markPrice: 100000,
  }));
  assert(r.shouldMove, "trailing short: $102k < $103k, should move down");
  assert(Math.abs(r.newStopPrice! - 102000) < 1, `trailing short new SL = $${r.newStopPrice!.toFixed(1)} (expected ~$102000)`);
}

console.log("\nTrailing: breakevenApplied is ignored (trails continuously)");
{
  // Even with breakevenApplied=true, trailing should still evaluate
  const r = evaluateTrailing(baseInput({
    trailingMode: "trailing",
    breakevenApplied: true,
    markPrice: 106000,
  }));
  assert(r.shouldMove, "trailing: ignores breakevenApplied flag");
  assert(Math.abs(r.newStopPrice! - 103880) < 1, `new SL = $${r.newStopPrice!.toFixed(1)} (expected ~$103880)`);
}

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
