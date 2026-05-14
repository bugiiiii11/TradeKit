/**
 * Unit test: S6 compression counter seeding
 *
 * Pure function tests — no exchange calls, no .env needed.
 * Run: npx ts-node src/scripts/test_s6_seed.ts
 */

import { evaluateS6, resetS6State, seedS6Compression } from "../strategy/s6_bbwp_breakout";

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

function evalAndCapture(bbwp: number, close: number, ema21: number): string {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (msg: string) => logs.push(msg);
  evaluateS6({ bbwp, close, ema21 });
  console.log = origLog;
  return logs.find(l => l.includes("[S6-diag]")) ?? "";
}

console.log("\n=== S6 Compression Seed Tests ===\n");

// Test 1: Without seed, barsSinceCompression = never
console.log("Test 1: No seed — compression counter starts at Infinity");
resetS6State();
const diag1 = evalAndCapture(55, 100, 90);
assert(diag1.includes("compress=never(FAIL)"), "counter shows 'never' without seed");

// Test 2: Seed with recent compression
console.log("\nTest 2: Seed with BBWP that dipped below 20 recently");
resetS6State();
seedS6Compression([45, 30, 15, 25, 35]); // bbwp=15 was 2 bars ago
const diag2 = evalAndCapture(55, 100, 90);
assert(diag2.includes("bars(ok)") || diag2.includes("3bars"), "counter reflects recent compression");

// Test 3: Seed with old compression (beyond lookback of 40)
console.log("\nTest 3: Seed with compression too old (>40 bars ago)");
resetS6State();
const history = Array.from({ length: 42 }, (_, i) => i === 0 ? 15 : 25 + i);
seedS6Compression(history); // bbwp=15 was 41 bars ago
const diag3 = evalAndCapture(55, 100, 90);
assert(diag3.includes("(FAIL)"), "counter shows FAIL for old compression");

// Test 4: Seed with no compression at all
console.log("\nTest 4: Seed with no compression in history");
resetS6State();
seedS6Compression([50, 55, 60, 65, 70]);
const diag4 = evalAndCapture(55, 100, 90);
assert(diag4.includes("(FAIL)"), "counter shows FAIL when never compressed");

// Test 5: Seed sets prevBbwp correctly for cross detection
console.log("\nTest 5: Seed + cross detection works");
resetS6State();
seedS6Compression([15, 25, 35, 45]); // prevBbwp=45, barsSinceCompression=3
const signal = evaluateS6({ bbwp: 55, close: 100, ema21: 90 }); // cross above 50, recent compression
assert(signal !== null, "signal fires after seed + cross50 with recent compression");
assert(signal?.direction === "long", "direction is long (close > ema21)");

// Test 6: Empty history is a no-op
console.log("\nTest 6: Empty history seed is safe");
resetS6State();
seedS6Compression([]);
const diag6 = evalAndCapture(55, 100, 90);
assert(diag6.includes("compress=never(FAIL)"), "empty seed keeps counter at Infinity");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
