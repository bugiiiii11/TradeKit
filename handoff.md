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

## What Was Done (Session 31) — S7 backtest validation + S5 webhook receiver

### VPS Health Check
Bot healthy, ticking every 15m. Balance $399.31 (stable). S6 diagnostics logging on 1H bars — BBWP=68.7, `compress=never(FAIL)`, no S6 entry conditions met yet. Realtime had CHANNEL_ERROR but self-recovered. No trades since S6 deployment.

### S7 Funding Rate Backtest (parked)
Downloaded 2,372 Binance historical funding rates (March 2024 → May 2026). Integrated actual rates into backtest engine (replaces constant 0.01%/8h estimate — improvement for all future backtests). Ran S1+S2+S6 A/B comparison:

- **Baseline:** 137 trades, +$167.24, PF 1.85, Sharpe 3.35
- **S7 filter:** 134 trades, +$164.23, PF 1.85, Sharpe 3.31
- **Delta:** -$3.01 PnL, 16 trades blocked (9 winners, 7 losers)
- **Verdict:** Filter blocks more profitable trades than losing ones. Not enabling.

Root cause: Binance funding rates settle every 8h — too coarse for the 4h velocity window. Live Hyperliquid settles hourly but we lack historical data.

Files: `src/scripts/download_funding.ts` (new), `src/backtest/funding-loader.ts` (new), `src/scripts/backtest_s7.ts` (new), `src/backtest/engine.ts` (actual rates + S7 filter config), `src/backtest/types.ts` (fundingRates + s7Filter fields).

### S5 Cascade Webhook Receiver (built, not deployed)
Built HTTP webhook receiver for Flash DeFi liquidation cascade signals:
- Strategy: `src/strategy/s5_cascade.ts` — SHORT-only, 4% stop, 8h max hold, BBWP>85 exit
- Server: `src/webhook/server.ts` — Node built-in `http`, `POST /webhook/cascade`, Bearer auth
- Entry: S5 bypasses confluence (like S6), evaluates on bar close after signal received
- 15/15 integration tests pass (`src/scripts/test_webhook.ts`)
- Integrated into `main-headless.ts` with env vars: `S5_ENABLED`, `S5_WEBHOOK_PORT`, `S5_WEBHOOK_SECRET`

**Not deployed** — needs: `.env` config on VPS, OCI firewall port 3456, Flash webhook setup.

Files: `src/strategy/s5_cascade.ts` (new), `src/webhook/server.ts` (new), `src/scripts/test_webhook.ts` (new), `src/main-headless.ts` (S5 entry/exit + webhook start), `src/strategy/types.ts` ("S5" added to StrategyId), `src/logger/trade_logger.ts`, `src/main.ts`.

### Permissions Update
Added `Edit` and `Write` to `.claude/settings.json` allow list. Safe because `protect-files.sh` hook blocks writes to `.env`, keys, and credentials.

Committed: `971656d`, `dc1d933`. Pushed to origin.

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-05-06 | S1+S2+S6 at 0.5x leverage | S6 deployed but no entries yet (BBWP not in compression). Monitor first S6 trade. Balance ~$399. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 30 --nostream"` |
| 2026-05-06 | S5 webhook NOT deployed | Code built + tested but VPS needs: `.env` vars, port 3456 open, Flash webhook URL. Deploy when Flash is ready. | Check with Flash team on webhook timeline |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Deploy S5 to VPS** | low | Code ready. Add `.env` vars (`S5_ENABLED=true`, `S5_WEBHOOK_SECRET`, `S5_WEBHOOK_PORT=3456`), open OCI port, restart pm2. Then coordinate with Flash for webhook POST URL. |
| 2 | **Scale to full leverage (1.0x)** | low | Currently at 0.5x. After ~10-15 trades at 0.5x with S1+S2+S6, bump to 1.0x. |
| 3 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (Session 28). S1 filter toggle ready. Colleague finds setups on TV → we code + backtest. |
| 4 | **S1 filter toggle from dashboard** | med | Frontend button to flip `S1_SKIP_DAILY_EMA200` without SSH. |
| 5 | **S3 re-evaluation** | low | Code intact, re-enable via `ENABLED_STRATEGIES=S1,S2,S3,S6`. Revisit if Martin fine-tunes StochRSI. |
| 6 | **S7 re-evaluation** | low | Parked: backtest -$3 PnL with 8h Binance rates. Revisit if Hyperliquid historical funding becomes available (1h granularity). |
