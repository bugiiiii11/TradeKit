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
import { placeMarketOrder, placeLimitOrder, closePosition, cancelOrder, setStopLoss, setScaledTakeProfits } from "./hyperliquid/orders";
import { getBalance, getOpenPositions, getFundingRate, getUserFills, getOpenBtcTriggerOrders } from "./hyperliquid/account";
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
import { initDiscord, sendDiscord, Colors } from "./notifications/discord";

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
  stopOid?: string;
  tpOids?: string[];
}

const activePositions: ActivePosition[] = [];

async function hydrateActivePositions(): Promise<void> {
  const livePositions = await getOpenPositions();
  const btcPositions = livePositions.filter(p => p.coin === "BTC" && p.sizeBase > 0);

  if (btcPositions.length === 0) {
    console.log("[Bot-VPS] No open positions to hydrate.");
    return;
  }

  const triggerOrders = await getOpenBtcTriggerOrders();

  for (const pos of btcPositions) {
    const closeSide: "B" | "A" = pos.direction === "long" ? "A" : "B";
    const posOrders = triggerOrders.filter(o => o.side === closeSide);

    const slOrder = posOrders.find(o =>
      pos.direction === "long" ? o.triggerPx < pos.entryPrice : o.triggerPx > pos.entryPrice
    );
    const tpOrders = posOrders.filter(o =>
      pos.direction === "long" ? o.triggerPx > pos.entryPrice : o.triggerPx < pos.entryPrice
    );

    const stopPrice = slOrder?.triggerPx ?? pos.entryPrice * (pos.direction === "long" ? 0.996 : 1.004);
    const stopDistancePct = Math.abs(pos.entryPrice - stopPrice) / pos.entryPrice;
    const riskDollar = stopDistancePct * pos.entryPrice * pos.sizeBase;

    let strategy: "S1" | "S2" | "S3" = "S3";
    if (tpOrders.length < 3) {
      const s1Lev = Math.max(1, Math.round(10 * LEVERAGE_MULT));
      const s2Lev = Math.max(1, Math.round(8 * LEVERAGE_MULT));
      if (pos.leverage === s1Lev && s1Lev !== s2Lev) strategy = "S1";
      else if (pos.leverage === s2Lev && s2Lev !== s1Lev) strategy = "S2";
    }

    let entryTimestamp: string;
    try {
      const fills = await getUserFills(Date.now() - 48 * 60 * 60 * 1000);
      const entrySide: "B" | "A" = pos.direction === "long" ? "B" : "A";
      const entryFill = fills
        .filter(f => f.side === entrySide && Math.abs(f.closedPnl) < 0.01)
        .sort((a, b) => b.time - a.time)
        .find(f => Math.abs(f.price - pos.entryPrice) / pos.entryPrice < 0.005);
      entryTimestamp = entryFill
        ? new Date(entryFill.time).toISOString()
        : new Date().toISOString();
    } catch {
      entryTimestamp = new Date().toISOString();
    }

    activePositions.push({
      strategy,
      direction: pos.direction,
      entryPrice: pos.entryPrice,
      entryTimestamp,
      sizeBase: pos.sizeBase,
      stopPrice,
      marginUsd: pos.marginUsed,
      riskDollar,
      leverage: pos.leverage,
      confluenceScore: 0,
      stopDistancePct,
      stopOid: slOrder ? String(slOrder.oid) : undefined,
      tpOids: tpOrders.length > 0 ? tpOrders.map(o => String(o.oid)) : undefined,
    });

    console.log(
      `[Bot-VPS] Hydrated position: ${strategy} ${pos.direction} ` +
      `@ $${pos.entryPrice.toFixed(0)}, ${pos.sizeBase} BTC, ${pos.leverage}x, ` +
      `SL=$${stopPrice.toFixed(0)}${slOrder ? "" : " (estimated)"}, ` +
      `${tpOrders.length} TP(s), entry=${entryTimestamp.slice(0, 19)}Z`
    );
  }

  sendDiscord("status",
    `Position hydrated on restart\n${activePositions.length} position(s) restored from Hyperliquid`,
    Colors.blue,
  );
}

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
    // Hyperliquid requires integer leverage
    const tradeLeverage = Math.max(1, Math.round(rawLeverage * LEVERAGE_MULT));

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

    // 9b. Block if position already open (Hyperliquid has one isolated position per asset)
    if (activePositions.length > 0) {
      const existing = activePositions.map(p => `${p.strategy}:${p.direction}`).join(", ");
      const incoming = signals.map(s => `${s.strategy}:${s.direction}`).join(", ");
      console.log(`[Bot-VPS] Entry blocked — position already open (${existing})`);
      sendDiscord("signals",
        `Entry BLOCKED — position already open\n${incoming} signal skipped\nOpen: ${existing}`,
        Colors.orange,
      );
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
      sendDiscord("signals",
        `Trade BLOCKED by risk manager\n${primarySignal.strategy} ${confluence.direction} — ${permission.reason}`,
        Colors.red,
      );
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

    let stopOid: string | undefined;
    if (!DRY_RUN) {
      stopOid = await setStopLoss(confluence.direction, stopPrice, sizing.positionBase);
    }

    // S3 TPs (only if S3 is enabled)
    let tpPrices: number[] = [];
    let tpOids: string[] = [];
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
        const tpResults = await setScaledTakeProfits(confluence.direction, entryPrice, sizing.positionBase, tpTargets);
        tpOids = tpResults.map(r => r.oid);
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
      stopOid,
      tpOids: tpOids.length > 0 ? tpOids : undefined,
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

    sendDiscord("trades",
      `${confluence.direction.toUpperCase()} ${primarySignal.strategy} opened\nEntry: $${entryPrice.toFixed(0)}\nSize: ${sizing.positionBase.toFixed(5)} BTC ($${sizing.positionUsd.toFixed(0)} notional)\nLeverage: ${tradeLeverage}x | SL: $${stopPrice.toFixed(0)}`,
      confluence.direction === "long" ? Colors.green : Colors.red,
    );
  } catch (err) {
    console.error("[Bot-VPS] Bar evaluation error:", err);
    sendDiscord("errors", `Bar evaluation error\n${err instanceof Error ? err.message : String(err)}`, Colors.red);
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
      sendDiscord("trades",
        `${pos.strategy} ${pos.direction} native close\nExit: $${exitPrice.toFixed(0)} | ${exitReason}\nPnL: ${pnlUsd >= 0 ? "+" : ""}$${pnlUsd.toFixed(2)}`,
        pnlUsd >= 0 ? Colors.green : Colors.orange,
      );
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
          // Cancel this position's specific SL/TP orders first
          const oidsToCancel = [pos.stopOid, ...(pos.tpOids ?? [])].filter(Boolean) as string[];
          for (const oid of oidsToCancel) {
            try { await cancelOrder(oid); } catch { /* already filled/canceled */ }
          }
          await closePosition(pos.direction, true);
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
        sendDiscord("trades",
          `${pos.strategy} ${pos.direction} CLOSED\nExit: $${exitPrice.toFixed(0)} | Reason: ${exitReason}\nPnL: ${pnlUsd >= 0 ? "+" : ""}$${pnlUsd.toFixed(2)}`,
          pnlUsd >= 0 ? Colors.green : Colors.orange,
        );
      } catch (err) {
        console.error(`[Bot-VPS] Exit error for ${pos.strategy}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Daily digest (00:00 UTC)
// ---------------------------------------------------------------------------

const DIGEST_INTERVAL_MS = parseInt(process.env.DIGEST_INTERVAL_HOURS ?? "2", 10) * 3_600_000;

function scheduleDailyDigest(): void {
  const fire = async () => {
    try {
      const balance = await getBalance();
      const s = getState();
      const positions = activePositions.length;
      const lines = [
        "Status Digest",
        `Balance: $${balance.toFixed(2)}`,
        `Daily PnL: ${s.dailyPnl >= 0 ? "+" : ""}$${s.dailyPnl.toFixed(2)}`,
        `Weekly PnL: ${s.weeklyPnl >= 0 ? "+" : ""}$${s.weeklyPnl.toFixed(2)}`,
        `Open positions: ${positions}`,
        `Consecutive losses: ${s.consecutiveLosses}`,
        `Status: ${s.killed ? "KILLED" : s.pausedUntil > Date.now() ? "PAUSED" : "ACTIVE"}`,
      ];
      sendDiscord("status", lines.join("\n"), Colors.blue);
    } catch (err) {
      console.error("[Bot-VPS] Digest error:", err);
    }
  };

  setInterval(() => void fire(), DIGEST_INTERVAL_MS);
  const hours = DIGEST_INTERVAL_MS / 3_600_000;
  console.log(`[Bot-VPS] Status digest scheduled every ${hours}h`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  initLogSink();
  initDiscord({
    trades: process.env.DISCORD_WEBHOOK_TRADES || undefined,
    errors: process.env.DISCORD_WEBHOOK_ERRORS || undefined,
    status: process.env.DISCORD_WEBHOOK_STATUS || undefined,
    signals: process.env.DISCORD_WEBHOOK_SIGNALS || undefined,
  }, "TradeKit VPS");

  console.log("[Bot-VPS] Starting BTC Trading Bot (Headless)...");
  console.log(`[Bot-VPS] Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`[Bot-VPS] Strategies: ${ENABLED_STRATEGIES.join(", ")}`);
  console.log(`[Bot-VPS] Leverage multiplier: ${LEVERAGE_MULT}x (S1=${Math.max(1,Math.round(10*LEVERAGE_MULT))}x, S2=${Math.max(1,Math.round(8*LEVERAGE_MULT))}x, S3=${Math.max(1,Math.round(5*LEVERAGE_MULT))}x)`);
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

  // Hydrate active positions from Hyperliquid
  try {
    await hydrateActivePositions();
  } catch (err) {
    console.warn("[Bot-VPS] Position hydration failed:", err);
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
  sendDiscord("status",
    `Bot started\nStrategies: ${ENABLED_STRATEGIES.join(", ")}\nLeverage: ${LEVERAGE_MULT}x (S1=${Math.max(1,Math.round(10*LEVERAGE_MULT))}x, S2=${Math.max(1,Math.round(8*LEVERAGE_MULT))}x, S3=${Math.max(1,Math.round(5*LEVERAGE_MULT))}x)\nBalance: $${STARTING_BANKROLL}`,
    Colors.blue,
  );

  // Daily digest at 00:00 UTC
  scheduleDailyDigest();

  // Graceful shutdown
  const shutdown = async (sig: string) => {
    console.warn(`[Bot-VPS] Received ${sig} — shutting down`);
    sendDiscord("status", `Bot shutting down (${sig})`, Colors.orange);
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
