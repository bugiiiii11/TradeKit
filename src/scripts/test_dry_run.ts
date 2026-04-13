/**
 * One-shot dry-run test — pulls all 4 timeframes from TradingView, fetches
 * the Hyperliquid balance, evaluates the strategy, and prints what the bot
 * WOULD do. Places no orders.
 *
 * Run with: npx ts-node src/scripts/test_dry_run.ts
 *
 * Pre-requisites:
 *   - TradingView running via launch_tradingview.ps1 with BTCUSDC chart
 *   - .env populated with valid Hyperliquid credentials
 */

import "dotenv/config";
import { TradingViewMCP } from "../mcp/client";
import { fetchAllSnapshots } from "../tradingview/reader";
import { evaluateS1 } from "../strategy/s1_ema_trend";
import { evaluateS2 } from "../strategy/s2_mean_reversion";
import { evaluateS3 } from "../strategy/s3_stoch_rsi";
import { scoreSignals } from "../strategy/confluence";
import { calcPositionSize } from "../risk/sizing";
import { canTrade } from "../risk/manager";
import { setBankroll } from "../risk/state";
import { getBalance } from "../hyperliquid/account";
import type { Signal } from "../strategy/types";

async function main(): Promise<void> {
  console.log("=== DRY-RUN TEST ===\n");

  // 1. Connect to TradingView MCP
  console.log("[1/5] Connecting to TradingView MCP...");
  const mcp = new TradingViewMCP();
  await mcp.connect();

  const health = (await mcp.callTool("tv_health_check")) as {
    success: boolean;
    cdp_connected: boolean;
    chart_symbol?: string;
  };
  if (!health?.success || !health.cdp_connected) {
    throw new Error("TradingView CDP not connected. Launch via launch_tradingview.ps1");
  }
  console.log(`  ✅ Connected | symbol: ${health.chart_symbol}\n`);

  // 2. Fetch indicator snapshots from all 4 timeframes
  console.log("[2/5] Fetching indicator snapshots (this takes ~12s)...");
  const { snap15m, snap1H, snap4H, snap1D } = await fetchAllSnapshots(mcp);
  console.log("\n  --- 15m ---");
  console.log(`    close=${snap15m.close} ema8=${snap15m.ema8} ema13=${snap15m.ema13} ema21=${snap15m.ema21} ema55=${snap15m.ema55} ema200=${snap15m.ema200}`);
  console.log(`    rsi=${snap15m.rsi14} stochK=${snap15m.stochK} stochD=${snap15m.stochD} bbwp=${snap15m.bbwp} pmarp=${snap15m.pmarp}`);
  console.log("  --- 1H ---");
  console.log(`    close=${snap1H.close} ema55=${snap1H.ema55} rsi=${snap1H.rsi14} bbwp=${snap1H.bbwp}`);
  console.log("  --- 4H ---");
  console.log(`    close=${snap4H.close} ema55=${snap4H.ema55} rsi=${snap4H.rsi14}`);
  console.log("  --- 1D ---");
  console.log(`    close=${snap1D.close} ema55=${snap1D.ema55} rsi=${snap1D.rsi14}\n`);

  // 3. Fetch Hyperliquid balance
  console.log("[3/5] Fetching Hyperliquid balance...");
  const balance = await getBalance();
  setBankroll(balance);
  console.log(`  ✅ Withdrawable: $${balance.toFixed(2)}\n`);

  // 4. Evaluate strategies
  console.log("[4/5] Evaluating strategies...");
  const signals: Signal[] = [];

  const s1 = evaluateS1(snap4H, snap1D);
  if (s1) {
    signals.push(s1);
    console.log(`  S1 (4H EMA trend): ${s1.direction} | stop=${(s1.stopDistancePct * 100).toFixed(2)}%`);
  } else {
    console.log("  S1: no signal");
  }

  const s2 = evaluateS2(snap1H, snap4H);
  if (s2) {
    signals.push(s2);
    console.log(`  S2 (1H mean rev): ${s2.direction} | stop=${(s2.stopDistancePct * 100).toFixed(2)}%`);
  } else {
    console.log("  S2: no signal");
  }

  const s3 = evaluateS3(snap15m, snap1H);
  if (s3) {
    signals.push(s3);
    console.log(`  S3 (15m stoch): ${s3.direction} | stop=${(s3.stopDistancePct * 100).toFixed(2)}%`);
  } else {
    console.log("  S3: no signal");
  }

  if (signals.length === 0) {
    console.log("\n[5/5] No signals — bot would do nothing this tick.");
    await mcp.close();
    return;
  }

  // 5. Confluence + sizing + risk gate
  console.log("\n[5/5] Confluence + sizing + risk gate...");
  const confluence = scoreSignals(signals, snap1D);
  console.log(`  confluence: score=${confluence.score} dir=${confluence.direction} leverage=${confluence.leverage}x risk=${(confluence.riskPercent * 100).toFixed(2)}%`);

  if (!confluence.direction || confluence.leverage === 0) {
    console.log("  → no trade (conflicting / filtered)");
    await mcp.close();
    return;
  }

  const primary = signals.find((s) => s.strategy === "S1") ??
                  signals.find((s) => s.strategy === "S2") ??
                  signals[0];
  const entry = snap15m.close;
  const sizing = calcPositionSize(
    balance,
    confluence.riskPercent,
    entry,
    primary.stopDistancePct,
    confluence.leverage
  );
  console.log(`  sizing: $${sizing.positionUsd.toFixed(2)} notional, $${sizing.marginUsd.toFixed(2)} margin, ${sizing.positionBase} BTC, risk $${sizing.riskDollar.toFixed(2)}`);

  const perm = canTrade(sizing);
  if (!perm.allowed) {
    console.log(`  → BLOCKED by risk manager: ${perm.reason}`);
  } else {
    const stopPrice = confluence.direction === "long"
      ? entry * (1 - primary.stopDistancePct)
      : entry * (1 + primary.stopDistancePct);
    console.log(`  → WOULD TRADE: ${primary.strategy} ${confluence.direction.toUpperCase()} ${sizing.positionBase} BTC @ $${entry.toFixed(2)} stop=$${stopPrice.toFixed(2)}`);
  }

  await mcp.close();
  console.log("\n=== DRY-RUN COMPLETE ===");
}

main().catch((err) => {
  console.error("\n❌ FAILED:", err.message ?? err);
  process.exit(1);
});
