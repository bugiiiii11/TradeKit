/**
 * BTC Trading Bot — Main loop
 *
 * Architecture:
 *   TradingView MCP → indicator snapshots
 *   → Strategy evaluation (S1/S2/S3)
 *   → Confluence scoring + macro filter
 *   → Risk manager gate
 *   → Position sizing
 *   → Hyperliquid order execution
 *   → Trade logger
 *
 * Loop cadence: every 15 minutes (configurable via LOOP_INTERVAL_MS)
 * S1 is re-evaluated every 4H only; S2 every 1H; S3 every 15m.
 */

import "dotenv/config";
import { fetchAllSnapshots, MCPClient } from "./tradingview/reader";
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
import { getBalance, getOpenPositions, getFundingRate } from "./hyperliquid/account";
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
import { TradingViewMCP } from "./mcp/client";

const LOOP_INTERVAL_MS = parseInt(process.env.LOOP_INTERVAL_MS ?? "900000", 10); // 15 min
const STARTING_BANKROLL = parseFloat(process.env.BANKROLL ?? "500");
const DRY_RUN = (process.env.DRY_RUN ?? "false").toLowerCase() === "true";

// Track last evaluation times to throttle S1 (4H) and S2 (1H)
let lastS1EvalTime = 0;
let lastS2EvalTime = 0;

// Track active positions opened by this bot
interface ActivePosition {
  strategy: "S1" | "S2" | "S3";
  direction: "long" | "short";
  entryPrice: number;
  entryTimestamp: string;
  sizeBase: number;
  stopPrice: number;
  marginUsd: number;
  /** Dollars risked per the sizing calc — used to compute pnl_r on close. */
  riskDollar: number;
  /** Leverage applied at entry (from confluence scorer). */
  leverage: number;
  /** Confluence score at entry time. */
  confluenceScore: number;
  /** Stop distance as fraction of entry (e.g. 0.03). */
  stopDistancePct: number;
}

const activePositions: ActivePosition[] = [];

// ---------------------------------------------------------------------------
// MCP client — spawns tradingview-mcp as a child process and connects via
// stdio. Verifies the chart is healthy (CDP connected, BTCUSDC loaded)
// before returning.
// ---------------------------------------------------------------------------
async function createMCPClient(): Promise<MCPClient> {
  const mcp = new TradingViewMCP();
  await mcp.connect();

  // Verify TradingView is reachable and on the right symbol.
  const health = (await mcp.callTool("tv_health_check")) as {
    success: boolean;
    cdp_connected: boolean;
    chart_symbol?: string;
  };
  if (!health || !health.success || !health.cdp_connected) {
    throw new Error(
      "TradingView is not running with CDP enabled. " +
        "Launch via launch_tradingview.ps1 first."
    );
  }
  console.log(`[Bot] TradingView MCP connected | symbol: ${health.chart_symbol}`);
  return mcp;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function runLoop(mcpClient: MCPClient): Promise<void> {
  console.log(`\n[Bot] ===== Loop tick ${new Date().toISOString()} =====`);

  try {
    const killed = getState().killed;

    // 1. Fetch indicator snapshots from TradingView
    const { snap15m, snap1H, snap4H, snap1D } = await fetchAllSnapshots(mcpClient);

    // 2. Sync balance from Hyperliquid
    const balance = await getBalance();
    setBankroll(balance);
    console.log(`[Bot] Hyperliquid balance: $${balance.toFixed(2)}`);

    // 2b. Mirror Hyperliquid open positions into public.positions. Non-fatal.
    // Always runs — even killed, we still want the dashboard to reflect the
    // actual post-kill account state.
    try {
      const openPositions = await getOpenPositions();
      await syncPositions(openPositions, { BTC: snap15m.close });
    } catch (err) {
      console.warn("[Bot] syncPositions failed:", err);
    }

    // 3. Check exits on active positions — SKIPPED when killed. Kill switch
    // already closed everything; strategy exit logic must not re-engage.
    if (!killed) {
      await checkExits(snap15m, snap1H, snap4H);
    }

    // 4. Fetch current BTC funding rate (non-fatal if it fails).
    let fundingRate: number | null = null;
    try {
      fundingRate = await getFundingRate();
    } catch (err) {
      console.warn("[Bot] getFundingRate failed:", err);
    }

    // 5. Evaluate strategies (with time-gating)
    const now = Date.now();
    const signals: Signal[] = [];

    // S3: every 15m (every loop)
    const s3 = evaluateS3(snap15m, snap1H);
    if (s3) signals.push(s3);

    // S2: every 1H
    if (now - lastS2EvalTime >= 60 * 60 * 1000) {
      const s2 = evaluateS2(snap1H, snap4H);
      if (s2) signals.push(s2);
      lastS2EvalTime = now;
    }

    // S1: every 4H
    if (now - lastS1EvalTime >= 4 * 60 * 60 * 1000) {
      const s1 = evaluateS1(snap4H, snap1D);
      if (s1) signals.push(s1);
      lastS1EvalTime = now;
    }

    // 6. Score confluence (scoreSignals handles empty signals — returns zeros).
    const confluence = scoreSignals(signals, snap1D);

    // Per-strategy fixed leverage (S1=10x, S2=8x, S3=5x).
    // Overrides the confluence scorer's leverage output.
    const tradeLeverage = getLeverageForSignals(signals);

    // 7. Write per-tick snapshots to Supabase. Placed BEFORE any early return so
    //    every tick produces a row in both tables. No-ops if env vars missing.
    //    Errors are caught inside the writers and never crash the loop.
    await writeMarketSnapshot({
      price: snap15m.close,
      fundingRate,
      snap15m,
      snap1H,
      snap4H,
      snap1D,
      confluence: signals.length > 0 ? confluence : null,
    });
    await writeRiskSnapshot({ state: getState() });

    // 8a. Early return if killed — snapshots already written above so the
    // dashboard reflects the current killed state, but no new entries.
    if (killed) {
      console.log(`[Bot] Killed — skipping entries (${getState().killedReason ?? "no reason"}).`);
      return;
    }

    // 8. Early return if no signals this tick — snapshots already written above.
    if (signals.length === 0) {
      console.log("[Bot] No signals this tick.");
      return;
    }

    console.log(`[Bot] Signals: ${signals.map((s) => `${s.strategy}:${s.direction}`).join(", ")}`);
    console.log(`[Bot] Confluence: score=${confluence.score}, direction=${confluence.direction}`);

    if (!confluence.direction || confluence.leverage === 0) {
      console.log("[Bot] Confluence: no trade (conflicting or filtered signals).");
      return;
    }

    // 9. Pick the highest-priority signal for sizing (use its stop distance)
    const primarySignal = signals.find((s) => s.strategy === "S1") ??
                          signals.find((s) => s.strategy === "S2") ??
                          signals[0];

    console.log(`[Bot] Strategy: ${primarySignal.strategy} @ ${tradeLeverage}x leverage`);

    const entryPrice = snap15m.close;
    // Margin-based sizing: always 5% of bankroll as margin, levered up per strategy.
    const MARGIN_PCT = 0.05;
    const sizing = calcMarginBasedSize(
      balance,
      MARGIN_PCT,
      entryPrice,
      primarySignal.stopDistancePct,
      tradeLeverage
    );

    console.log(
      `[Bot] Sizing: $${sizing.positionUsd.toFixed(2)} notional, ` +
      `$${sizing.marginUsd.toFixed(2)} margin (${(MARGIN_PCT * 100).toFixed(0)}% of bankroll), ` +
      `${tradeLeverage}x leverage, risk $${sizing.riskDollar.toFixed(2)}`
    );

    // 10. Risk manager gate
    const permission = canTrade(sizing);
    if (!permission.allowed) {
      console.log(`[Bot] Trade blocked: ${permission.reason}`);
      return;
    }

    // 11. Execute order (or simulate in dry-run mode)
    const stopPrice =
      confluence.direction === "long"
        ? entryPrice * (1 - primarySignal.stopDistancePct)
        : entryPrice * (1 + primarySignal.stopDistancePct);

    let txSig: string;
    if (DRY_RUN) {
      txSig = "DRY_RUN";
      console.log(
        `[DRY_RUN] Would ${primarySignal.strategy === "S2" ? "LIMIT" : "MARKET"} ` +
          `${confluence.direction.toUpperCase()} ${sizing.positionBase.toFixed(6)} BTC ` +
          `@ $${entryPrice.toFixed(2)} stop=$${stopPrice.toFixed(2)} ` +
          `${tradeLeverage}x`
      );
    } else if (primarySignal.strategy === "S2") {
      // S2: limit order at EMA55
      const limitPrice = snap1H.ema55;
      txSig = await placeLimitOrder(
        confluence.direction,
        sizing.positionBase,
        limitPrice,
        tradeLeverage
      );
    } else {
      // S1 and S3: market order
      txSig = await placeMarketOrder(
        confluence.direction,
        sizing.positionBase,
        tradeLeverage
      );
    }

    // 12. Place stop-loss (skipped in dry-run)
    if (!DRY_RUN) {
      await setStopLoss(confluence.direction, stopPrice, sizing.positionBase);
    }

    // 12b. Place take-profit orders (S3 only: scaled at 1% / 3% / 5%).
    // S1 and S2 use indicator-based exits (reverse EMA cross / PMARP / BBWP).
    // TPs are native Hyperliquid trigger orders — they fire in real-time,
    // not at the next loop tick. Skipped in dry-run.
    let tpPrices: number[] = [];
    if (primarySignal.strategy === "S3") {
      // S3 scaled TPs: 33% at +1%, 33% at +3%, 34% at +5%
      const tpTargets = [
        { pct: 0.01, portion: 0.33 },
        { pct: 0.03, portion: 0.33 },
        { pct: 0.05, portion: 0.34 },
      ];
      tpPrices = tpTargets.map(({ pct }) =>
        confluence.direction === "long"
          ? entryPrice * (1 + pct)
          : entryPrice * (1 - pct)
      );
      if (!DRY_RUN) {
        await setScaledTakeProfits(confluence.direction, entryPrice, sizing.positionBase, tpTargets);
        console.log(
          `[Bot] S3 TPs set: ${tpPrices.map((p) => `$${p.toFixed(2)}`).join(" / ")}`
        );
      } else {
        console.log(
          `[DRY_RUN] Would set S3 TPs: ${tpPrices.map((p) => `$${p.toFixed(2)}`).join(" / ")}`
        );
      }
    }

    // 13. Record position
    const entryTimestamp = new Date().toISOString();
    const position: ActivePosition = {
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
    };
    activePositions.push(position);
    recordTradeOpen(sizing.marginUsd);

    // 14. Log trade
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
      notes: `tx: ${txSig}`,
    });

  } catch (err) {
    console.error("[Bot] Loop error:", err);
  }
}

// ---------------------------------------------------------------------------
// Exit checker
// ---------------------------------------------------------------------------

async function checkExits(
  snap15m: import("./tradingview/reader").IndicatorSnapshot,
  snap1H: import("./tradingview/reader").IndicatorSnapshot,
  snap4H: import("./tradingview/reader").IndicatorSnapshot
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
          console.log(
            `[DRY_RUN] Would CLOSE ${pos.strategy} ${pos.direction} ` +
              `${pos.sizeBase} BTC @ $${exitPrice.toFixed(2)}`
          );
        } else {
          await closePosition(pos.direction);
        }

        const pnlUsd =
          pos.direction === "long"
            ? (exitPrice - pos.entryPrice) * pos.sizeBase
            : (pos.entryPrice - exitPrice) * pos.sizeBase;

        recordTradeResult(pnlUsd, pos.marginUsd);
        logTradeClose(pos.entryTimestamp, exitPrice, exitReason);

        // Persist the closed trade to Supabase. Non-fatal — errors are caught
        // inside insertClosedTrade and logged but never crash the loop.
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
        });

        activePositions.splice(i, 1);
        console.log(`[Bot] Exited ${pos.strategy} ${pos.direction} — reason: ${exitReason}, PnL: $${pnlUsd.toFixed(2)}`);
      } catch (err) {
        console.error(`[Bot] Exit error for ${pos.strategy}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Install Supabase log sink FIRST so all subsequent console.* calls are
  // captured. No-ops if SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are missing.
  initLogSink();

  console.log("[Bot] Starting BTC Trading Bot...");
  console.log(`[Bot] Mode: ${DRY_RUN ? "DRY RUN (no orders will be placed)" : "LIVE"}`);
  console.log(`[Bot] Starting bankroll: $${STARTING_BANKROLL}`);
  console.log(`[Bot] Loop interval: ${LOOP_INTERVAL_MS / 60000} minutes`);

  const mcpClient = await createMCPClient();

  // Hydrate risk state from the newest risk_snapshots row. This restores
  // dailyPnl / consecutiveLosses / pausedUntil / killed state across
  // restarts so an accidental crash (or today's OOM freeze) doesn't wipe
  // the daily drawdown budget or the auto-pause timer. Fully guarded —
  // any failure falls back to the default initialState() with a warning.
  try {
    const hydrated = await loadLatestRiskState();
    if (hydrated) {
      hydrateState(hydrated);
      const s = getState();
      console.log(
        `[Bot] Hydrated risk state from ${hydrated.takenAt} — ` +
          `bankroll=$${s.bankroll.toFixed(2)} dailyPnl=$${s.dailyPnl.toFixed(2)} ` +
          `weeklyPnl=$${s.weeklyPnl.toFixed(2)} losses=${s.consecutiveLosses} ` +
          `paused=${s.pausedUntil > 0 ? new Date(s.pausedUntil).toISOString() : "no"} ` +
          `killed=${s.killed}${s.killedReason ? ` (${s.killedReason})` : ""}`,
      );
    } else {
      console.log("[Bot] No prior risk snapshot — starting from fresh state.");
    }
  } catch (err) {
    console.warn("[Bot] Risk state hydration failed — using fresh state:", err);
  }

  // Start the command bus subscription (kill switch, resume, etc.). Handlers
  // need a way to clear our local activePositions[] tracking after a kill —
  // pass a callback so handlers.ts doesn't need to import main.ts.
  await startCommandSubscription({
    clearActivePositions: () => {
      activePositions.length = 0;
    },
  });

  // Graceful shutdown — unsubscribe the Realtime channel on Ctrl-C / SIGTERM
  // so we don't leak the WebSocket. The log sink has its own flush hook.
  const shutdown = async (sig: string) => {
    console.warn(`[Bot] Received ${sig} — shutting down`);
    await stopCommandSubscription().catch((err) =>
      console.error("[Bot] stopCommandSubscription failed:", err)
    );
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  // Print portfolio stats on startup
  printPortfolioStats(STARTING_BANKROLL);

  // Initial run
  await runLoop(mcpClient);

  // Schedule loop
  setInterval(() => {
    runLoop(mcpClient).catch(console.error);
  }, LOOP_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[Bot] Fatal error:", err);
  process.exit(1);
});
