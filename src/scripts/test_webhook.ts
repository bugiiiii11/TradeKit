/**
 * Test the S5 webhook server in isolation.
 *
 * Starts the webhook server, sends test requests via fetch, validates responses.
 *
 * Usage: npx ts-node src/scripts/test_webhook.ts
 */

import { startWebhookServer } from "../webhook/server";
import { getPendingSignal, clearPendingSignal } from "../strategy/s5_cascade";
import { initDiscord } from "../notifications/discord";

const PORT = 9876;
const SECRET = "test-secret-123";
const BASE = `http://localhost:${PORT}`;

initDiscord({}, "test");

async function test(
  name: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json() as Record<string, unknown>;
  return { status: res.status, body: json };
}

async function main(): Promise<void> {
  const server = startWebhookServer({ port: PORT, secret: SECRET });

  // Wait for server to be ready
  await new Promise(r => setTimeout(r, 200));

  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, detail?: string): void {
    if (condition) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
      failed++;
    }
  }

  console.log("\n=== S5 Webhook Tests ===\n");

  // Test 1: Health check
  console.log("1. Health check");
  const health = await test("health", "GET", "/health");
  assert("returns 200", health.status === 200);
  assert("has status ok", health.body.status === "ok");

  // Test 2: Wrong path
  console.log("\n2. Wrong path");
  const notFound = await test("notfound", "POST", "/webhook/wrong", {}, { Authorization: `Bearer ${SECRET}` });
  assert("returns 404", notFound.status === 404);

  // Test 3: No auth
  console.log("\n3. No auth header");
  const noAuth = await test("noauth", "POST", "/webhook/cascade", { severity: "high" });
  assert("returns 401", noAuth.status === 401);

  // Test 4: Wrong auth
  console.log("\n4. Wrong auth token");
  const wrongAuth = await test("wrongauth", "POST", "/webhook/cascade", { severity: "high" }, { Authorization: "Bearer wrong" });
  assert("returns 401", wrongAuth.status === 401);

  // Test 5: Invalid severity
  console.log("\n5. Invalid severity");
  const badSev = await test("badsev", "POST", "/webhook/cascade", { severity: "low" }, { Authorization: `Bearer ${SECRET}` });
  assert("returns 400", badSev.status === 400);

  // Test 6: Valid cascade signal
  console.log("\n6. Valid cascade signal (high)");
  clearPendingSignal();
  const valid = await test("valid", "POST", "/webhook/cascade", {
    severity: "high",
    estimated_impact_usd: 75000000,
    imminent_count: 15,
    aggregate_debt_usd: 100000000,
    chains: ["ethereum", "base"],
    timestamp: "2026-05-06T12:00:00Z",
  }, { Authorization: `Bearer ${SECRET}` });
  assert("returns 200", valid.status === 200);
  assert("accepted true", valid.body.accepted === true);
  const pending = getPendingSignal();
  assert("signal stored", pending !== null);
  assert("severity=high", pending?.severity === "high");
  assert("impact=$75M", pending?.estimatedImpactUsd === 75000000);
  assert("chains correct", pending?.chains?.length === 2);

  // Test 7: Critical signal overwrites
  console.log("\n7. Critical signal overwrites pending");
  const crit = await test("crit", "POST", "/webhook/cascade", {
    severity: "critical",
    estimated_impact_usd: 200000000,
    imminent_count: 30,
    aggregate_debt_usd: 500000000,
    chains: ["ethereum", "base", "arbitrum"],
  }, { Authorization: `Bearer ${SECRET}` });
  assert("returns 200", crit.status === 200);
  const pending2 = getPendingSignal();
  assert("signal overwritten", pending2?.severity === "critical");
  assert("impact updated", pending2?.estimatedImpactUsd === 200000000);

  // Summary
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===\n`);

  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
