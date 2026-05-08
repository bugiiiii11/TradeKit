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

## What Was Done (Session 33) — 26-month backtest validation, S2 disabled

### 26-Month Backtest
Ran S1+S2+S6 on full 26-month Binance data (March 2024 → May 2026, 76k rows, 429-day window after warmup). Results weaker than the 12-month window: **+$133.66 (+26.7%), 156 trades, PF 1.59, Sharpe 2.53**. Extra months added unfavorable regimes.

Per-strategy: S1 +$87 (9 trades, 78% WR — sniper), S6 +$76 (105 trades, 46% WR — workhorse), **S2 -$30 (42 trades, 31% WR — net drag)**.

### S2 Removal Confirmed
Ran S1+S6-only backtest: **+$165.74 (+33.1%), 124 trades, PF 1.92, Sharpe 3.45**. Every metric improved. S6 picked up 10 extra trades from freed position slots. S1 gained slightly (+$87→$89).

### S2 Disabled on VPS
Changed `ENABLED_STRATEGIES=S1,S6` in VPS `.env`, restarted pm2. Startup confirms: `Strategies: S1, S6`. S2 code untouched — can be re-enabled for future experiments. No code changes this session.

### Balance Note
VPS balance $370.63 (down from $390 in S32). Zero bot trades — drop is from Martin's manual web UI trades. Risk state shows `dailyPnl=$-26.03`. Hydration fix (S32) prevents bot interference with manual trades, but manual trade losses are Martin's domain.

### Decision Gate Bug (backlogged)
Backtest reporter's automated verdict doesn't evaluate S6 (only checks S1/S2/S3). Reports "no positive expectancy" despite S6 having 105 trades at +$76. Low priority — doesn't affect live bot.

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-05-08 | S1+S6 at 1.0x leverage | S2 disabled (S33). Monitor first S1/S6 trades without S2 blocking slots. Balance ~$370. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 50 --nostream"` |
| 2026-05-07 | Hydration fix deployed | Trade-log cross-check live. Untested with real position — next restart with an open position will validate. | Check startup logs after next restart |
| 2026-05-06 | S5 cascade pipe LIVE | Full pipe working. Hourly heartbeats confirmed. Monitor for first `high` severity signal. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 10 --nostream \| grep -i cascade"` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Monitor first trades at 1.0x (S1+S6)** | low | S2 removed, S6 gets more slots. Validate sizing, fee impact at full leverage. |
| 2 | **Dashboard control panel (Tier 1)** | med | Strategy toggles (S1/S6 on/off), S1 filter toggle, leverage slider, live bot status card. All via existing command bus pattern. ~1-2 sessions. |
| 3 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (S28). Hydration fix (S32) protects web UI trades. |
| 4 | **Decision gate bug fix** | low | Backtest reporter doesn't evaluate S6. Quick fix in `src/backtest/reporter.ts`. |
| 5 | **S2 re-evaluation** | low | Disabled (S33). Code intact. Revisit if entry logic fundamentally reworked (current mean-reversion approach loses on BTC perps). |
| 6 | **S3 re-evaluation** | low | Same as S2 — mean-reversion on BTC perps is structurally unfavorable. Revisit if Martin fine-tunes StochRSI. |
| 7 | **S7 re-evaluation** | low | Parked: backtest -$3 PnL with 8h Binance rates. Revisit if Hyperliquid historical funding becomes available. |
