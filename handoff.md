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

### S5 Cascade Webhook Receiver (built + deployed + Flash wired)
Built HTTP webhook receiver for Flash DeFi liquidation cascade signals:
- Strategy: `src/strategy/s5_cascade.ts` — SHORT-only, 4% stop, 8h max hold, BBWP>85 exit
- Server: `src/webhook/server.ts` — Node built-in `http`, `POST /webhook/cascade`, Bearer auth
- Entry: S5 bypasses confluence (like S6), evaluates on bar close after signal received
- 15/15 integration tests pass (`src/scripts/test_webhook.ts`)

**Deployed to VPS:** `.env` configured (`S5_ENABLED=true`, secret, port 3456), pm2 restarted, webhook confirmed live. Flash's main bot (`liq-morpho-eth`) runs on Contabo — connected via persistent SSH tunnel (`autossh` + pm2) to OCI2 `localhost:3456`. No OCI firewall change needed.

**Flash side live:** `liq-morpho-eth` fires `medium` heartbeats hourly (tunnel health) and `high`/`critical` on cascade events (IMMINENT > 10 AND debt > $50M). 4h dedup cooldown. Tunnel health monitor with Telegram alerts on Contabo. Heartbeats confirmed received in TradeKit logs.

### Discord Notification Tuning
- Removed `medium` heartbeat spam from `#tradekit-signals` — only `high`/`critical` cascade signals posted there
- Added S5 heartbeat status to 2h Status Digest in `#tradekit`: count + last-seen + ⚠️ if >2h gap

### Doc Cleanup
Deleted 5 stale docs from `docs/` (VPS plan, colleague tasks, analysis) and 3 temp research docs. Kept: session-archive, strategy-ideas-from-flash, grid-lessons, s4-analysis.

### Permissions Update
Added `Edit` and `Write` to `.claude/settings.json` allow list. Safe because `protect-files.sh` hook blocks writes to `.env`, keys, and credentials.

Committed: `971656d`, `dc1d933`, `c58f9e1`, `63ead03`, `50d8cb5`. All pushed.

---

## What Was Done (Session 32) — Hydration fix + leverage scale-up

### Balance Investigation ($9 Drop)
Wrote `src/scripts/investigate_balance.ts` — queries Hyperliquid's `userFillsByTime`, `userFunding`, and `userNonFundingLedgerUpdates` APIs directly (read-only, no private key needed). Found 63 fills in 14 days on VPS wallet: -$6.47 closed PnL + -$2.10 fees + -$0.05 funding = -$8.62. Root cause: Martin placed manual trades via Hyperliquid web UI (0.01 BTC, ~$1000 notional) — bot hydrated them as S1/S2 based on leverage, applied exit logic, closed them at a loss.

### Hydration Fix (P1)
Replaced leverage-heuristic strategy guessing in `hydrateActivePositions()` with trade-log cross-check. On restart, bot reads `trades/trade_log.json` for open records (exit_price === null). Positions matching a log entry get the logged strategy; positions with no match are tagged `"manual"` and skipped by exit logic. This prevents the bot from interfering with web UI trades.

Files: `src/main-headless.ts` (hydration rewrite, lines 121-173). Committed: `cb3da8e`.

### Leverage Scale-Up (P2)
Changed `LEVERAGE_MULT` from 0.5 to 1.0 in VPS `.env`. Effective leverage now: S1=10x, S2=8x, S6=8x. Notional sizing doubled (~$40 positions). Rationale: 30 trades at 0.5x validated stability; fee drag (0.09% RT) was eating profits on ~$20 positions. Deployed in same restart as hydration fix.

### Backtest Data Refresh
Ran `download_binance.ts --months=26`. Klines now cover March 2024 → May 7, 2026 (76,548 rows, 26 months). April 2026 partial replaced with full month, May 2026 partial added. Funding rates were already current from Session 31.

### S2 Confluence Analysis (P3 — analysis only, no code change)
S2's real gate is the **macro filter** (confluence.ts:137-150), not the confluence score. S2 alone scores 3/10 (enough to trade), but `applyMacroFilter()` kills S2 longs when BTC < Daily EMA200 (current market). S2 standalone contributed ~$2/year in backtests. Relaxing S2 filters was tested in Session 25 and rejected. Recommendation: leave S2 as-is; its value is as a confluence booster for S1, not standalone.

### Settings Cleanup
Moved machine-specific SSH permission from `.claude/settings.json` to `settings.local.json`. Committed: `705a91c`.

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-05-07 | S1+S2+S6 at 1.0x leverage | Scaled from 0.5x. First trades at full leverage need monitoring — validate sizing, fee impact, SL placement. Balance ~$390. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 50 --nostream"` |
| 2026-05-07 | Hydration fix deployed | Trade-log cross-check live. Untested with real position — next restart with an open position will validate. Should show `[trade-log]` or `[external (skip exit logic)]`. | Check startup logs after next restart |
| 2026-05-06 | S5 cascade pipe LIVE | Full pipe working: Flash `liq-morpho-eth` (Contabo) → SSH tunnel → TradeKit webhook (OCI2). Hourly heartbeats confirmed. Monitor for first `high` severity signal. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 10 --nostream \| grep -i cascade"` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Monitor first trades at 1.0x** | low | Scaled from 0.5x (Session 32). Validate sizing (~$40 notional), fee proportionality, SL placement at full leverage. |
| 2 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (Session 28). Hydration fix (Session 32) now protects web UI trades from bot interference. |
| 3 | **S1 filter toggle from dashboard** | med | Frontend button to flip `S1_SKIP_DAILY_EMA200` without SSH. |
| 4 | **Run backtest on refreshed data** | low | 26-month klines through May 7. Quick validation: `npx ts-node src/scripts/backtest_binance.ts --strategies S1,S2,S6 --bankroll 500`. |
| 5 | **S3 re-evaluation** | low | Code intact, re-enable via `ENABLED_STRATEGIES=S1,S2,S3,S6`. Revisit if Martin fine-tunes StochRSI. |
| 6 | **S7 re-evaluation** | low | Parked: backtest -$3 PnL with 8h Binance rates. Revisit if Hyperliquid historical funding becomes available (1h granularity). |
