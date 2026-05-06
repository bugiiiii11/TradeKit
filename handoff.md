# TradeKit — Session Handoff

> Single source of truth for resuming work across chat sessions.
> Updated by `/wrap`. Read by `/start` at the beginning of each session.
>
> **Trimming convention:** Keep only the last ~3 sessions here. When a session
> is older than that and fully documented (code committed, docs updated), move
> it to `docs/session-archive.md`. This keeps handoff.md small and focused.
>
> **Permanent project context** (architecture, key files, risk config, security)
> lives in `CLAUDE.md` (auto-loaded every message). Do NOT duplicate it here.

---

## What Was Done (Session 28) — Manual trade bug fix + S1 filter + S3 disabled

### VPS Deep Dive
Bot healthy: 42h uptime, 0 restarts, 73MB memory. Balance $397.85 → $399.31. Found a manual trade (20x long, TPs $84.9k/$85.8k) was closed by the bot's S3 exit logic after 75 min at +$2.62 instead of riding to target. Also found S3 short #1 stopped out (-$0.23), S3 short #2 opened and stopped out. Martin reported a Krown indicator bullish signal matching the manual trade's targets.

### Manual Trade Bug Fix (critical)
Manual trades placed via command bus were registered with `strategy: "S3"`, causing S3 exit logic to close them prematurely. Fixed in both bots:
- Added `"manual"` to `StrategyId` type
- `registerManualPosition` now uses `strategy: "manual"`
- `checkExits` skips manual positions — only native SL/TP can close them
- Hydration defaults to `"manual"` for unrecognized leverage (safer than S3)

Files: `src/strategy/types.ts`, `src/main-headless.ts`, `src/main.ts`, `src/logger/trade_logger.ts`. Committed: `f2a808d`. Deployed to VPS.

### S1 Daily-EMA200 Filter Configurable
S1 longs were blocked by `Daily-EMA200=below`, missing trend reversal entries. Made the filter configurable:
- `S1_CONFIG.requireDailyEma200` driven by `S1_SKIP_DAILY_EMA200` env var (default: false = filter on)
- Confluence macro filter respects S1 exemption when configured

Backtest on 379 days: neutral in mixed portfolio (S1: 10→13 trades, -$1.09), positive in S1-only isolation (+4 trades, +$3.89, lower DD). Keep filter on by default, toggle via env var when conviction is high.

Files: `src/strategy/s1_ema_trend.ts`, `src/strategy/confluence.ts`, `src/scripts/backtest_s1_filter.ts` (new). Committed: `ac8c261`. Deployed to VPS.

### S3 Cost-Benefit Analysis + Disabled
Ran S1+S2+S3 vs S1+S2-only backtest on 379 days. S3 standalone: 779 trades, -$81.95, profit factor 0.51, Sharpe -6.86. Removing S3: PnL +$25→+$81, DD 10.7%→4.8%, Sharpe 0.57→3.55. Disabled S3 on VPS via `ENABLED_STRATEGIES=S1,S2` env var. S3 code fully intact, re-enable anytime.

### Flash Grid Lessons
Got production grid trading knowledge transfer from Flash project (4 months live on Base). Saved to `docs/grid-trading-lessons-flash.md`. Key lessons: rapid momentum detector, sell-only mode during pause, volatility-adaptive spacing, auto-recenter with daily cap, state persistence after every fill.

---

## What Was Done (Session 29) — S4 Grid strategy backtest (not viable)

### Grid Backtest Engine
Built a separate grid backtest engine (`src/backtest/grid-engine.ts`) — grids manage N concurrent cells vs 1 position, so the directional engine couldn't be extended. Reuses existing data pipeline (Binance loader → aggregator → aligner).

Files: `src/strategy/s4_grid.ts` (config, types, helpers), `src/backtest/grid-engine.ts` (simulation engine), `src/scripts/backtest_grid.ts` (CLI). Committed: `aaeedd8`.

### 9-Config Parameter Sweep
Tested across spacing (0.3%–2.0%), levels (3–10), recenter policies (aggressive/slow/disabled), and regime filter on/off. 379-day window on Binance data.

**Best result:** -$6.38 (-1.3%) with 0.8% spacing, 5 levels, zero recenters, no regime filter. But grid was only active 5.3% of the time — 84 round-trips in 379 days.

### Root Cause: Structural Mismatch
- **Recenters are fatal:** every config with recentering showed recenter losses > gross profit (-$64 to -$438)
- **Without recenters, grid is dormant 95%:** BTC exits 8% range in days, doesn't return
- **Funding NOT the killer:** only -$4/year on long side — confirmed via per-side tracking
- **Flash vs S4:** Flash works because spot (zero holding cost, local mean-reversion from DEX arb). BTC perps trend too much.

### S6 BBWP Breakout Backtest
Validated S6 (BBWP volatility breakout) on 379-day Binance data. S6 standalone: 29 trades, +$71, 62% win rate, 1.87 profit factor. Combined S1+S2+S6 portfolio: +$168 (+33.6%), 2x the S1+S2 baseline (+$81), with only 1.3% more drawdown. S6 bypasses confluence — independent entry as fallback when S1/S2 don't fire.

Files: `src/strategy/s6_bbwp_breakout.ts` (new), `src/backtest/engine.ts` (S6 integrated), `src/scripts/backtest_s6.ts` (new). Committed: `bc539d8`.

### Conclusion
Both S3 (scalp) and S4 (grid) confirm: **BTC perps favor trend-following (S1, S2), not mean-reversion.** S4 code preserved for future experiments on mean-reverting instruments. S6 validated and ready for live integration.

---

## What Was Done (Session 30) — S6 BBWP Breakout live integration

### S6 Live Integration
Integrated S6 into the VPS bot (`main-headless.ts`):
- S6 evaluation on 1H bar closes (same time-gate as S2), bypasses confluence
- Restructured entry flow: S1/S2/S3 confluence first → S6 independent fallback if no position opened
- S6 entry: 8x base leverage (4x at current 0.5x mult), 2% stop, market order
- S6 exit: `shouldExitS6()` — BBWP cycle complete (>85 → <35) or EMA8/55 reverse cross on 1H
- Goes through risk manager (position cap, drawdown checks, margin sizing)
- Single-position model preserved: S1/S2 get priority, S6 only enters when slot is empty

### Type Updates
Added `"S6"` to `StrategyId` in `types.ts`, `ActivePosition` in both bots, `TradeRecord` in trade logger. Removed `as any` cast from `s6_bbwp_breakout.ts`.

### Deployment
- Pushed to origin: `6fd18b0`
- VPS: `ENABLED_STRATEGIES=S1,S2,S6`, bot restarted via pm2
- Startup logs confirm: `Strategies: S1, S2, S6 | Leverage: 0.5x (S1=5x, S2=4x, S6=4x)`

### Known Limitation
S6 uses same base leverage as S2 (8x). On restart hydration, can't disambiguate S6 vs S2 positions by leverage alone — defaults to S2. Acceptable since both have similar stop distances and the SL is always set natively on Hyperliquid.

### S6 Diagnostics
Added `[S6-diag]` logging on every 1H evaluation — shows BBWP, prev BBWP, cross50 pass/fail, compression recency, EMA21 direction. Same pattern as S2-diag. Deployed: `1d42a2f`.

### Backtest Verification
Ran S1+S2+S6 combined backtest on 379-day Binance data: **+$168.25 (+33.6%), 137 trades, PF 1.86, Sharpe 3.38**. Matches the S29 validated result exactly. Integration is correct.

### S7 Funding Rate Momentum Filter
Built optional S1/S2 entry filter (`src/strategy/s7_funding_filter.ts`). Records funding rate on every 15m bar close, computes 4-hour velocity delta. Blocks entries when funding velocity opposes trade direction. **Disabled by default** — enable with `S7_FUNDING_FILTER=true` in VPS `.env`. No backtest validation (historical funding data not available). Deployed: `ac85bed`.

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-05-06 | S1+S2+S6 at 0.5x leverage | S6 + S6-diag + S7 (OFF) deployed. Monitor first S6 trades for correct entry/exit. Balance ~$399. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 30 --nostream"` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Enable S7 funding filter** | low | Flip `S7_FUNDING_FILTER=true` on VPS after funding rates have accumulated for a few days. Monitor for false blocks. |
| 2 | **S5 Cascade Signal Overlay** | med | DeFi liquidation cascade as SHORT entry signal. Needs Flash webhook (~30min their side). 2-5x/year, high alpha per event. |
| 3 | **Scale to full leverage (1.0x)** | low | Currently at 0.5x. After ~10-15 trades at 0.5x with S1+S2+S6, bump to 1.0x. |
| 4 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (Session 28). S1 filter toggle ready. Colleague finds setups on TV → we code + backtest. |
| 5 | **S1 filter toggle from dashboard** | med | Frontend button to flip `S1_SKIP_DAILY_EMA200` without SSH. |
| 6 | **S3 re-evaluation** | low | Code intact, re-enable via `ENABLED_STRATEGIES=S1,S2,S3,S6`. Revisit if Martin fine-tunes StochRSI. |
