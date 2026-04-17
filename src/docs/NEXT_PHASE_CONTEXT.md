# TradingBot — Next Phase Context & Handoff

**Created:** 2026-04-17  
**For:** Claude Code sessions planning VPS deployment of profitable bot version  
**Status:** Ready for clarifications before detailed implementation plan

---

## Executive Summary

The TradingBot project has evolved into two potential paths:
1. **Demo version** (~1-2 weeks) — LLM-on-chart for Krown Trading partnership pitch
2. **Profitable version** (~6-8 weeks) — Headless VPS bot, drop TradingView, execute on Hyperliquid

**Current decision:** Build profitable version for VPS. This document captures the state, key architecture decisions, and critical questions that must be answered before detailed implementation planning.

---

## Current State of Trading Bot

### What Exists Today

**Live/active bot:**
- Runs on desktop with TradingView Desktop connected via MCP
- Executes trades on **Hyperliquid** (not Drift — Drift was hacked April 1, 2026)
- Strategies: **S1 (EMA cross), S2 (RSI mean reversion), S3 (Stochastic RSI scalp)**
- Local indicator computation: `src/indicators.ts` (EMA, RSI, Stoch RSI, BBWP, PMARP)
- Risk management: Kill switch, resume controls, manual trade entry via dashboard
- Database: Supabase (stores trades, positions, snapshots)
- Monitoring: Telegram integration for alerts and manual trade entry

**Command system:**
- Kill switch, resume, manual trade placement via Supabase MCP
- Handlers: `src/commands/handlers.ts` (idempotent, can handle retries)
- Manual trades tagged with `source: "manual"` to skip bot strategy exit logic

**Backtesting infrastructure:**
- `src/backtest/engine.ts` — runs historical simulations
- Data source: Hyperliquid candleSnapshot API (~52-day history max)
- Results logged to JSON, visible in Supabase dashboard
- Issue: 52-day window limits multi-month strategy validation

### Git Status

```
M  src/backtest/collector.ts
M  src/backtest/engine.ts
M  src/db/trades.ts
M  src/main.ts
M  src/scripts/test_custom_trade.ts
M  src/strategy/s3_stoch_rsi.ts
M  trades/trade_log.json
?? backtest-180d.log, backtest-360d*.log, backtest-results/ (logs from recent testing)
```

Recent commits (Session 18):
- `0155e74` — Detect native TP/SL closes + log manual trades
- `981b714` — Backtest results to Supabase + dashboard layout
- `191c1e5` — S3 overtrading fix + backtests page

### Recent Changes (Session 18)

1. **Manual trade routing fixed**: Trades placed via dashboard (`handleManualTrade`) now tagged with `strategy: "manual"` instead of "S3", preventing bot exit logic from closing them. Closes only via native Hyperliquid SL/TP.

2. **S3 time-gating restored**: 
   - Re-added `S3_MIN_HOLD_MS = 45 * 60 * 1000` (45-minute minimum hold before reverse-Stoch-RSI cross exits)
   - Backtest analysis: all reverse-cross exits at ≤45min were losses (100% loss rate on short holds)
   - Removed: 2h max hold (user preference for longer holds)

3. **Backtest limitations identified**: Hyperliquid's candleSnapshot only returns ~52 days of 15m candles. All "180d" and "360d" backtests reused the same 52-day data window, creating false confidence in longer test results.

### Strategy Performance (Latest 52-day backtest, current data window)

| Strategy | Trades | Win Rate | PnL USD | Status |
|----------|--------|----------|---------|--------|
| S1 (EMA Cross) | 4 | 50% | -$6.99 | Small sample, insufficient signal |
| S2 (RSI MR) | ? | ? | +$11.16 | Positive, keep as-is |
| S3 (Stoch RSI) | Many | ? | -$8.13 | Negative after 45-min hold restored |

**Interpretation**: Samples too small to be statistically significant. S2 shows promise. S3 needs parameter tuning. Need multi-month backtest data to validate.

---

## Architecture Decisions (Already Made)

### ✅ Venue: Hyperliquid (replacing Drift)
- **Why**: Drift hacked $270M+ on 2026-04-01, protocol frozen. Hyperliquid is healthy, $4-5B TVL, 0.025% taker / -0.015% maker.
- **Live today**: Bot executes on Hyperliquid via official SDK
- **No change needed**: VPS version stays on Hyperliquid

### ✅ Data source: Hyperliquid OHLCV + local indicators
- **Why**: Drop TradingView MCP — adds ToS risk, CDP brittleness, TV Desktop dependency
- **Status**: Local indicators.ts already exists and computes EMA, RSI, Stoch RSI, BBWP, PMARP
- **Question**: Are these validated to match TradingView's output? (See clarifications)

### ✅ Strategies: S1/S2/S3 (Krown framework)
- **Why**: Mechanics are sound (EMA cross, RSI MR, Stoch scalp are standard TA)
- **Status**: Implemented, backtested, deployed
- **Gate**: Before VPS deployment, must validate on multi-month OOS data (see data limitations below)

---

## Critical Limitations & Gotchas

### 1. Backtest Data Window (52-day limit)
**Problem**: Hyperliquid candleSnapshot endpoint returns only ~52 days of 15m candles max. Current backtests labeled "180d" and "360d" recycle the same 52-day window.

**Impact**: 
- Cannot properly validate strategies over 6-12 month periods
- Current strategy metrics (win rate, avg loss, PnL) are overfitted to one 52-day data range
- Paper trading on testnet will use the same data recycling issue

**Solution needed**: Wire Binance public API into backtest engine for proper multi-month historical data. This is a **gate** for the profitable version — cannot go live without validating over larger data.

### 2. Indicator Parity (TradingView vs Local)
**Problem**: Bot's local indicators.ts may diverge from TradingView's Pine Script implementations.

**Current state**: Indicators exist and have been backtested with current TradingView signals, but no formal audit comparing output.

**Impact**: Small mismatches (e.g., EMA calculation, RSI smoothing) compound over time. A 1-2% divergence in RSI could flip strategy entries/exits.

**Solution needed**: Before going live on VPS (without TV), validate local indicators match TradingView output on a 2-week sample. Acceptable tolerance: <1% divergence per indicator.

### 3. Time-gating Edge Case in S3
**Current**: S3 has 45-min minimum hold before reverse-Stoch-RSI cross can trigger exit. User removed 2h max hold.

**Risk**: Very long holds could accumulate slippage/fees that erase profits. No hard upper bound.

**Status**: Working as designed (user explicitly chose this), but monitor for positions held >4h.

---

## Key Files & Their Roles

### Strategy Files
- `src/strategy/s1_ema_trend.ts` — EMA 8/55 cross, 4H + daily confirmation
- `src/strategy/s2_rsi_diverg.ts` — RSI divergence + EMA filter (not reviewed in this session, assume working)
- `src/strategy/s3_stoch_rsi.ts` — Stoch RSI %K/%D cross, 15m entry + 1H trend filter, 45-min min hold

### Indicator & Signal Core
- `src/indicators.ts` — Computes EMA, RSI, Stoch RSI, BBWP, PMARP from OHLCV bars
- `src/strategy/types.ts` — Signal interface (direction, strategy, stopDistancePct)
- `src/tradingview/reader.ts` — MCP client that reads indicators from TradingView Desktop (to be replaced)

### Execution & Risk
- `src/hyperliquid/orders.ts` — Hyperliquid SDK wrappers (placeMarketOrder, setStopLoss, setTakeProfit, closePosition)
- `src/hyperliquid/account.ts` — getOpenPositions, account state queries
- `src/hyperliquid/client.ts` — SDK initialization
- `src/risk/state.ts` — In-memory bot state (killed flag, canTrade checks)
- `src/main.ts` — Event loop: fetch OHLCV → evaluate strategies → check exits → place orders

### Database & Logging
- `src/db/trades.ts` — insertClosedTrade() interface, logs closed trades with strategy/source
- `src/db/snapshots.ts` — writeRiskSnapshot() for dashboard state
- `src/db/supabase.ts` — Supabase client init

### Backtesting
- `src/backtest/engine.ts` — Main backtest loop, uses same checkExits/evaluateStrategy logic as live
- `src/backtest/collector.ts` — Fetches historical OHLCV from Hyperliquid
- `src/scripts/test_custom_trade.ts` — Manual trade testing utility

### Commands & Handlers
- `src/commands/handlers.ts` — Kill switch, resume, manual trade entry
- `src/commands/subscription.ts` — Listens to Supabase for command rows, dispatches handlers
- Manual trade routing: Dashboard → Supabase row → handler → places order → registerManualPosition in activePositions[] → reconciliation loop detects native TP/SL closes

---

## What Must Be Clarified Before Detailed Plan

These are blocking questions for the implementation plan:

### 1. Indicator Validation
- **Q**: Are the local indicators in `src/indicators.ts` already validated to match TradingView's Pine Script output (within acceptable tolerance)?
- **Current assumption**: They exist and have been used in backtests, but no explicit audit.
- **Impact**: If not validated, this adds a 1-week validation sprint before VPS deployment.

### 2. Strategy Selection for VPS
- **Q**: For the VPS profitable version, deploy:
  - All three strategies (S1/S2/S3)?
  - Just the strongest one (S2) first, add others later?
  - Or run a fresh backtest cycle on all three before deciding?
- **Current status**: S2 shows +$11.16, S1/S3 negative in 52-day sample (too small to trust).
- **Impact**: Scope of implementation and testing effort.

### 3. Backtest Data Strategy
- **Q**: Should the plan include:
  - **Option A**: Integrate Binance public API to pull 6-12 months of BTC OHLCV, rewrite backtest engine to use it
  - **Option B**: Accept 52-day limit, backtest in Pine Script instead (free on TradingView), use Hyperliquid testnet for 4-week paper trading before live
  - **Option C**: Both (Binance for deep validation, Pine Script for quick iteration)
- **Impact**: 1-2 weeks extra engineering for Option A vs. Option B's simplicity but less rigorous validation.
- **Recommendation** (from analysis doc): Option B for speed to live, Option A for robustness. Hybrid = best.

### 4. Infrastructure & Capital
- **Q**: VPS deployment:
  - Target: OCI ARM #2 (spare capacity, shared pm2 + Telegram manager with existing Sui bots)?
  - Or: Fresh VPS elsewhere?
- **Q**: Capital & phasing:
  - Paper trade on Hyperliquid testnet for 4 weeks first, then $1.5k live?
  - Or: Can we assume testnet validation will be quick and jump to live sooner?
- **Impact**: Deployment complexity and timeline.

### 5. Transition Strategy
- **Q**: During VPS deployment, should we:
  - Run both (old: TradingView Desktop + new: VPS) in parallel for validation before cutover?
  - Or: Stop the desktop bot and cutover directly once testnet looks clean?
- **Impact**: Risk tolerance and validation rigor.

### 6. Monitoring & Alerting
- **Q**: For VPS operation, should we:
  - Keep existing Telegram integration (already working)?
  - Add additional monitoring (status checks, heartbeat pings)?
  - Log to a central observability tool (Datadog, New Relic)?
- **Impact**: Ops complexity and alert reliability.

---

## Environment & Dependencies

### Current Infrastructure
- **Runtime**: Node 22, TypeScript strict mode
- **Key packages**:
  - `@hyperliquid/sdk` — exchange API
  - `technicalindicators` — indicator library (or `tulind` for C-backed perf)
  - `@supabase/supabase-js` — database client
  - `puppeteer` or CDP client — TradingView MCP (to be removed)
- **VCS**: Git on main branch
- **CI/CD**: None currently (manual npm start)
- **Process supervision**: pm2 (target for VPS)
- **Monitoring**: Telegram bot (already integrated)

### Target VPS Environment
- **Host**: OCI ARM #2 (assumed, pending clarification #4)
- **OS**: Linux (Ubuntu 22.04 or similar)
- **Process manager**: pm2 (existing infrastructure)
- **Telegram control**: extend existing `bot-manager-telegram` to add TradingBot as 4th process
- **Database**: Supabase (cloud, no changes)
- **Environment secrets**: `.env` with Hyperliquid API key, Supabase key

---

## Known Issues & Workarounds

### From Memory (Session Tracking)

**MCP OAuth Gotchas** (if ever re-enabling TradingView MCP):
- Windows-specific: active VPN can intercept TLS to supabase.com, breaking OAuth
- Windows-specific: `/mcp` localhost callback listener times out if debugging is slow
- Workaround: Disable VPN during MCP auth flow, avoid long breakpoints during callback

**Next.js 16 config**: If frontend ever runs on same machine, prefer `next.config.js` (CJS) over `next.config.ts` (ESM/CJS interop bugs caused a laptop freeze + Turbopack OOM in Session 11).

**Supabase API keys**: Bot uses new `sb_secret_...` format (not legacy JWT). Legacy keys disabled project-wide as of 2026-04-11.

---

## Success Criteria for VPS Deployment

Once clarifications are answered, the plan should target:

1. **Code review gate**: Strategy engine, risk manager, execution layer all reviewed
2. **Testnet gate**: 4 weeks of paper trading on Hyperliquid testnet, zero unexpected crashes
3. **Indicator parity gate** (if needed): Local indicators match TradingView within <1%
4. **Backtest data gate** (if needed): Multi-month backtest shows positive expectancy OOS
5. **Live gate**: Expectancy matches paper trading, kill switch/resume working, Telegram alerts functional
6. **VPS gate**: Process starts on boot via pm2, logs rotate, no manual intervention needed for 1 week

---

## Next Steps (Once Clarifications Answered)

1. **Phase 0** (1 week, no code): Answer clarifications, finalize backtest data strategy, validate indicator parity
2. **Phase 1** (2-3 weeks): Implement backtest data source (if needed), build indicator validation script
3. **Phase 2** (2-3 weeks): Refactor `src/tradingview/reader.ts` → direct Hyperliquid WebSocket consumer, validate live signals match
4. **Phase 3** (1-2 weeks): Paper trade on testnet, monitor for infrastructure surprises
5. **Phase 4** (ongoing): Live deployment with $1.5k-2k capital, weekly trade review

---

## Questions for Next Claude Session

**Before writing detailed implementation plan, answer these:**

1. Indicator parity — already validated, or needs audit?
2. Strategy selection — all three or pilot with S2?
3. Backtest data — Binance API (robust but +1-2 weeks), Pine Script (fast but limited), or hybrid?
4. Infrastructure — OCI ARM #2 or fresh VPS?
5. Capital & phasing — paper trade first, or live sooner?
6. Transition — run both (TV + VPS) in parallel or cutover directly?
7. Monitoring — Telegram only, or additional tooling?

**Do not proceed with detailed phase breakdown until these are clarified.**

---

## Files to Review Before Starting

- `analysis-and-recommendations.md` — Strategic overview of profit vs. demo versions
- `src/main.ts` — Event loop architecture (large file, skim entry point only)
- `src/strategy/s3_stoch_rsi.ts` — Example strategy file (recently tuned)
- `src/backtest/engine.ts` — Backtest loop, understand data source limitations
- `src/commands/handlers.ts` — Risk controls and manual trade routing
- `.env.example` (or existing `.env`) — Verify Hyperliquid credentials structure

---

*Prepared 2026-04-17 for handoff to next Claude Code session. If reading >2 weeks later, re-check Drift Protocol incident status and Hyperliquid API stability. All technical decisions assume those remain unchanged.*
