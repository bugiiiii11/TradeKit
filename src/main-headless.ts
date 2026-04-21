/**
 * BTC Trading Bot — Headless Entry Point (VPS)
 *
 * Architecture:
 *   Hyperliquid WebSocket (15m) → local indicator computation
 *   → Strategy evaluation (S1/S2, S3 disabled)
 *   → Confluence scoring + macro filter
 *   → Risk manager gate
 *   → Position sizing
 *   → Hyperliquid order execution
 *
 * Mirrors main.ts but replaces TradingView MCP with WebSocket candles
 * + local indicator computation. Everything after strategy evaluation
 * is identical. Both bots can run simultaneously with separate wallets.
 *
 * Usage: npx ts-node src/main-headless.ts
 * VPS:   node dist/main-headless.js (via pm2)
 */

import "dotenv/config";
import { CandleConsumer } from "./ws/candle-consumer";
import type { IndicatorSnapshot } from "./tradingview/reader";
import { evaluateS1, shouldExitS1 } from "./strategy/s1_ema_trend";
import { evaluateS2, shouldExitS2 } from "./strategy/s2_mean_reversion";
import { evaluateS3, shouldExitS3 } from "./strategy/s3_stoch_rsi";
import { scoreSignals, getLeverageForSignals } from "./strategy/confluence";
import { calcMarginBasedSize } from "./risk/sizing";
import { canTrade } from "./risk/manager";
import {
  setBankroll,
  recordTradeOpen,
  recordTradeResult,
  getState,
  hydrateState,
} from "./risk/state";
import { placeMarketOrder, placeLimitOrder, closePosition, setStopLoss, setScaledTakeProfits } from "./hyperliquid/orders";
import { getBalance, getOpenPositions, getFundingRate, getUserFills } from "./hyperliquid/account";
import type { PositionInfo } from "./hyperliquid/account";
import { logTradeOpen, logTradeClose } from "./logger/trade_logger";
import {
  writeMarketSnapshot,
  writeRiskSnapshot,
  loadLatestRiskState,
} from "./db/snapshots";
import { syncPositions } from "./db/positions";
import { insertClosedTrade } from "./db/trades";
import { initLogSink } from "./db/logs";
import { startCommandSubscription, stopCommandSubscription } from "./db/commands";
import { printPortfolioStats } from "./logger/portfolio";
import { Signal } from "./strategy/types";

const STARTING_BANKROLL = parseFloat(process.env.BANKROLL ?? "500");
const DRY_RUN = (process.env.DRY_RUN ?? "false").toLowerCase() === "true";
const BOT_SOURCE = "vps-bot";

const ENABLED_STRATEGIES = (process.env.ENABLED_STRATEGIES ?? "S1,S2,S3")
  .split(",")
  .map(s => s.trim());

// Leverage multiplier for reduced-risk deployment (0.25 = quarter leverage)
const LEVERAGE_MULT = parseFloat(process.env.LEVERAGE_MULT ?? "0.25");

let lastS1EvalTime = 0;
let lastS2EvalTime = 0;

interface ActivePosition {
  strategy: "S1" | "S2" | "S3";
  direction: "long" | "short";
  entryPrice: number;
  entryTimestamp: string;
  sizeBase: number;
  stopPrice: number;
  marginUsd: number;
  riskDollar: number;
  leverage: number;
  confluenceScore: number;
  stopDistancePct: number;
}

const activePositions: ActivePosition[] = [];

// ---------------------------------------------------------------------------
// Main evaluation — called on each 15m bar close from WebSocket
// ---------------------------------------------------------------------------

async function onBarClose(snapshots: {
  snap15m: IndicatorSnapshot;
  snap1H: IndicatorSnapshot;
  snap4H: IndicatorSnapshot;
  snap1D: IndicatorSnapshot;
}): Promise<void> {
  const { snap15m, snap1H, snap4H, snap1D } = snapshots;
  console.log(`\n[Bot-VPS] ===== Bar close ${snap15m.timestamp} =====`);

  try {
    const killed = getState().killed;

    // 1. Sync balance
    const balance = await getBalance();
    setBankroll(balance);
    console.log(`[Bot-VPS] Balance: $${balance.toFixed(2)}`);

    // 2. Sync positions
    let livePositions: PositionInfo[] = [];
    try {
      livePositions = await getOpenPositions();
      await syncPositions(livePositions, { BTC: snap15m.close });
    } catch (err) {
      console.warn("[Bot-VPS] syncPositions failed:", err);
    }

    // 3. Reconcile — detect native TP/SL closes
    await reconcilePositions(livePositions);

    // 4. Check exits (skip if killed)
    if (!killed) {
      await checkExits(snap15m, snap1H, snap4H);
    }

    // 5. Fetch funding rate
    let fundingRate: number | null = null;
    try {
      fundingRate = await getFundingRate();
    } catch (err) {
      console.warn("[Bot-VPS] getFundingRate failed:", err);
    }

    // 6. Evaluate strategies (with time-gating + enable filter)
    const now = Date.now();
    const signals: Signal[] = [];

    if (ENABLED_STRATEGIES.includes("S3")) {
      const s3 = evaluateS3(snap15m, snap1H);
      if (s3) signals.push(s3);
    }

    if (ENABLED_STRATEGIES.includes("S2") && now - lastS2EvalTime >= 60 * 60 * 1000) {
      const s2 = evaluateS2(snap1H, snap4H);
      if (s2) signals.push(s2);
      lastS2EvalTime = now;
    }

    if (ENABLED_STRATEGIES.includes("S1") && now - lastS1EvalTime >= 4 * 60 * 60 * 1000) {
      const s1 = evaluateS1(snap4H, snap1D);
      if (s1) signals.push(s1);
      lastS1EvalTime = now;
    }

    // 7. Confluence scoring
    const confluence = scoreSignals(signals, snap1D);
    const rawLeverage = getLeverageForSignals(signals);
    const tradeLeverage = Math.max(1, Math.round(rawLeverage * LEVERAGE_MULT * 10) / 10);

    // 8. Write snapshots to Supabase
    await writeMarketSnapshot({
      price: snap15m.close,
      fundingRate,
      snap15m,
      snap1H,
      snap4H,
      snap1D,
      confluence: signals.length > 0 ? confluence : null,
      source: "vps-bot",
    });
    await writeRiskSnapshot({ state: getState(), source: "vps-bot" });

    // 9. Early returns
    if (killed) {
      console.log(`[Bot-VPS] Killed — skipping entries.`);
      return;
    }

    if (signals.length === 0) {
      console.log("[Bot-VPS] No signals this bar.");
      return;
    }

    console.log(`[Bot-VPS] Signals: ${signals.map(s => `${s.strategy}:${s.direction}`).join(", ")}`);
    console.log(`[Bot-VPS] Confluence: score=${confluence.score}, direction=${confluence.direction}`);

    if (!confluence.direction || confluence.leverage === 0) {
      console.log("[Bot-VPS] No trade (conflicting or filtered).");
      return;
    }

    // 10. Sizing
    const primarySignal = signals.find(s => s.strategy === "S1")
      ?? signals.find(s => s.strategy === "S2")
      ?? signals[0];

    const entryPrice = snap15m.close;
    const MARGIN_PCT = 0.05;
    const sizing = calcMarginBasedSize(balance, MARGIN_PCT, entryPrice, primarySignal.stopDistancePct, tradeLeverage);

    console.log(
      `[Bot-VPS] Sizing: $${sizing.positionUsd.toFixed(2)} notional, ` +
      `$${sizing.marginUsd.toFixed(2)} margin, ${tradeLeverage}x leverage`
    );

    // 11. Risk gate
    const permission = canTrade(sizing);
    if (!permission.allowed) {
      console.log(`[Bot-VPS] Trade blocked: ${permission.reason}`);
      return;
    }

    // 12. Execute
    const stopPrice = confluence.direction === "long"
      ? entryPrice * (1 - primarySignal.stopDistancePct)
      : entryPrice * (1 + primarySignal.stopDistancePct);

    let txSig: string;
    if (DRY_RUN) {
      txSig = "DRY_RUN";
      console.log(
        `[DRY_RUN] Would ${primarySignal.strategy === "S2" ? "LIMIT" : "MARKET"} ` +
        `${confluence.direction.toUpperCase()} ${sizing.positionBase.toFixed(6)} BTC ` +
        `@ $${entryPrice.toFixed(2)} stop=$${stopPrice.toFixed(2)} ${tradeLeverage}x`
      );
    } else if (primarySignal.strategy === "S2") {
      const limitPrice = snap1H.ema55;
      txSig = await placeLimitOrder(confluence.direction, sizing.positionBase, limitPrice, tradeLeverage);
    } else {
      txSig = await placeMarketOrder(confluence.direction, sizing.positionBase, tradeLeverage);
    }

    if (!DRY_RUN) {
      await setStopLoss(confluence.direction, stopPrice, sizing.positionBase);
    }

    // S3 TPs (only if S3 is enabled)
    let tpPrices: number[] = [];
    if (primarySignal.strategy === "S3") {
      const tpTargets = [
        { pct: 0.01, portion: 0.33 },
        { pct: 0.03, portion: 0.33 },
        { pct: 0.05, portion: 0.34 },
      ];
      tpPrices = tpTargets.map(({ pct }) =>
        confluence.direction === "long" ? entryPrice * (1 + pct) : entryPrice * (1 - pct)
      );
      if (!DRY_RUN) {
        await setScaledTakeProfits(confluence.direction, entryPrice, sizing.positionBase, tpTargets);
      }
    }

    // 13. Record position
    const entryTimestamp = new Date().toISOString();
    activePositions.push({
      strategy: primarySignal.strategy,
      direction: confluence.direction,
      entryPrice,
      entryTimestamp,
      sizeBase: sizing.positionBase,
      stopPrice,
      marginUsd: sizing.marginUsd,
      riskDollar: sizing.riskDollar,
      leverage: tradeLeverage,
      confluenceScore: confluence.score,
      stopDistancePct: primarySignal.stopDistancePct,
    });
    recordTradeOpen(sizing.marginUsd);

    logTradeOpen({
      timestamp: entryTimestamp,
      strategy: primarySignal.strategy,
      direction: confluence.direction,
      entry_price: entryPrice,
      stop_loss: stopPrice,
      take_profit: tpPrices.length > 0 ? tpPrices[0] : null,
      leverage: tradeLeverage,
      position_size_usd: sizing.positionUsd,
      margin_used_usd: sizing.marginUsd,
      risk_percent: MARGIN_PCT * 100,
      confluence_score: confluence.score,
      notes: `tx: ${txSig} | source: ${BOT_SOURCE}`,
    });
  } catch (err) {
    console.error("[Bot-VPS] Bar evaluation error:", err);
  }
}

// ---------------------------------------------------------------------------
// Position reconciliation (identical to main.ts)
// ---------------------------------------------------------------------------

async function reconcilePositions(livePositions: PositionInfo[]): Promise<void> {
  if (activePositions.length === 0) return;

  const liveBtcDirs = new Set(
    livePositions
      .filter(p => p.coin === "BTC" && p.sizeBase > 0)
      .map(p => p.direction)
  );

  for (let i = activePositions.length - 1; i >= 0; i--) {
    const pos = activePositions[i];
    if (liveBtcDirs.has(pos.direction)) continue;

    console.log(`[Bot-VPS] Detected native close for ${pos.strategy} ${pos.direction}`);

    try {
      const entryMs = new Date(pos.entryTimestamp).getTime();
      const fills = await getUserFills(entryMs);
      const closingSide = pos.direction === "long" ? "A" : "B";
      const closingFills = fills
        .filter(f => f.side === closingSide && f.time >= entryMs)
        .sort((a, b) => b.time - a.time);

      let exitPrice: number, exitTime: string, closedPnl: number, exitReason: string;

      if (closingFills.length > 0) {
        const totalSize = closingFills.reduce((s, f) => s + f.size, 0);
        exitPrice = closingFills.reduce((s, f) => s + f.price * f.size, 0) / totalSize;
        exitTime = new Date(closingFills[0].time).toISOString();
        closedPnl = closingFills.reduce((s, f) => s + f.closedPnl, 0);
        exitReason = closedPnl >= 0 ? "native_tp" : "native_sl";
      } else {
        exitPrice = pos.entryPrice;
        exitTime = new Date().toISOString();
        closedPnl = 0;
        exitReason = "native_close_unknown";
      }

      const pnlUsd = pos.direction === "long"
        ? (exitPrice - pos.entryPrice) * pos.sizeBase
        : (pos.entryPrice - exitPrice) * pos.sizeBase;

      recordTradeResult(pnlUsd, pos.marginUsd);

      await insertClosedTrade({
        strategy: pos.strategy,
        direction: pos.direction,
        symbol: "BTC",
        size: pos.sizeBase,
        entryPrice: pos.entryPrice,
        exitPrice,
        entryTime: pos.entryTimestamp,
        exitTime,
        pnlUsd,
        riskDollar: pos.riskDollar,
        leverage: pos.leverage,
        confluenceScore: pos.confluenceScore,
        stopDistancePct: pos.stopDistancePct,
        exitReason,
        source: "vps-bot",
      });

      activePositions.splice(i, 1);
      console.log(`[Bot-VPS] Native close logged: PnL $${pnlUsd.toFixed(2)}, reason: ${exitReason}`);
    } catch (err) {
      console.error("[Bot-VPS] Reconciliation error:", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Exit checker (identical to main.ts)
// ---------------------------------------------------------------------------

async function checkExits(
  snap15m: IndicatorSnapshot,
  snap1H: IndicatorSnapshot,
  snap4H: IndicatorSnapshot,
): Promise<void> {
  for (let i = activePositions.length - 1; i >= 0; i--) {
    const pos = activePositions[i];
    let shouldExit = false;
    let exitReason = "";

    if (pos.strategy === "S1") {
      shouldExit = shouldExitS1(snap4H, pos.direction);
      if (shouldExit) exitReason = "s1_reverse_cross";
    } else if (pos.strategy === "S2") {
      shouldExit = shouldExitS2(snap1H, snap4H, pos.direction);
      if (shouldExit) exitReason = "s2_exit_condition";
    } else if (pos.strategy === "S3") {
      const result = shouldExitS3(snap15m, pos.direction, pos.entryPrice, pos.entryTimestamp);
      shouldExit = result.exit;
      exitReason = result.reason;
    }

    if (shouldExit) {
      try {
        const exitPrice = snap15m.close;
        if (DRY_RUN) {
          console.log(`[DRY_RUN] Would CLOSE ${pos.strategy} ${pos.direction}`);
        } else {
          await closePosition(pos.direction);
        }

        const pnlUsd = pos.direction === "long"
          ? (exitPrice - pos.entryPrice) * pos.sizeBase
          : (pos.entryPrice - exitPrice) * pos.sizeBase;

        recordTradeResult(pnlUsd, pos.marginUsd);
        logTradeClose(pos.entryTimestamp, exitPrice, exitReason);

        await insertClosedTrade({
          strategy: pos.strategy,
          direction: pos.direction,
          symbol: "BTC",
          size: pos.sizeBase,
          entryPrice: pos.entryPrice,
          exitPrice,
          entryTime: pos.entryTimestamp,
          exitTime: new Date().toISOString(),
          pnlUsd,
          riskDollar: pos.riskDollar,
          leverage: pos.leverage,
          confluenceScore: pos.confluenceScore,
          stopDistancePct: pos.stopDistancePct,
          exitReason,
          source: "vps-bot",
        });

        activePositions.splice(i, 1);
        console.log(`[Bot-VPS] Exited ${pos.strategy} ${pos.direction} — ${exitReason}, PnL: $${pnlUsd.toFixed(2)}`);
      } catch (err) {
        console.error(`[Bot-VPS] Exit error for ${pos.strategy}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  initLogSink();

  console.log("[Bot-VPS] Starting BTC Trading Bot (Headless)...");
  console.log(`[Bot-VPS] Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`[Bot-VPS] Strategies: ${ENABLED_STRATEGIES.join(", ")}`);
  console.log(`[Bot-VPS] Leverage multiplier: ${LEVERAGE_MULT}x (S1=${(10*LEVERAGE_MULT).toFixed(1)}x, S2=${(8*LEVERAGE_MULT).toFixed(1)}x, S3=${(5*LEVERAGE_MULT).toFixed(1)}x)`);
  console.log(`[Bot-VPS] Bankroll: $${STARTING_BANKROLL}`);
  console.log(`[Bot-VPS] Source tag: ${BOT_SOURCE}`);

  // Hydrate risk state
  try {
    const hydrated = await loadLatestRiskState("vps-bot");
    if (hydrated) {
      hydrateState(hydrated);
      const s = getState();
      console.log(
        `[Bot-VPS] Hydrated risk state — bankroll=$${s.bankroll.toFixed(2)} ` +
        `dailyPnl=$${s.dailyPnl.toFixed(2)} killed=${s.killed}`
      );
    }
  } catch (err) {
    console.warn("[Bot-VPS] Risk state hydration failed:", err);
  }

  // Command bus
  await startCommandSubscription({
    clearActivePositions: () => { activePositions.length = 0; },
    registerManualPosition: (pos) => {
      activePositions.push({
        strategy: "S3",
        direction: pos.direction,
        entryPrice: pos.entryPrice,
        entryTimestamp: pos.entryTimestamp,
        sizeBase: pos.sizeBase,
        stopPrice: pos.stopPrice,
        marginUsd: pos.marginUsd,
        riskDollar: pos.marginUsd,
        leverage: pos.leverage,
        confluenceScore: 0,
        stopDistancePct: pos.stopDistancePct,
      });
    },
  }, BOT_SOURCE);

  printPortfolioStats(STARTING_BANKROLL);

  // Start WebSocket candle consumer
  const consumer = new CandleConsumer({
    onBarClose: (snapshots) => {
      onBarClose(snapshots).catch(err => console.error("[Bot-VPS] onBarClose error:", err));
    },
    indicatorParams: { pmarpPeriod: 20, pmarpLookback: 350 },
  });

  await consumer.start();
  console.log("[Bot-VPS] WebSocket consumer running — waiting for bar closes...");

  // Graceful shutdown
  const shutdown = async (sig: string) => {
    console.warn(`[Bot-VPS] Received ${sig} — shutting down`);
    await consumer.stop();
    await stopCommandSubscription().catch(() => {});
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(err => {
  console.error("[Bot-VPS] Fatal error:", err);
  process.exit(1);
});
