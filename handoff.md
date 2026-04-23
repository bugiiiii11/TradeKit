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

## What Was Done (Session 20) — Knowledge architecture restructuring

1. **Created `CLAUDE.md`** — Permanent project context extracted from handoff.md. Auto-loaded every message.
2. **Created `docs/session-archive.md`** — Sessions 1-16 moved to cold storage.
3. **Trimmed `handoff.md`** — From 1138 lines to ~200.
4. **Initialized memory system** — Key project decisions and user preferences.

## What Was Done (Session 21) — VPS headless bot: build → backtest → deploy → LIVE

**Massive session: built, validated, and deployed the VPS headless bot end-to-end.**

### Phase 0: Validation Infrastructure
1. **TimeframeAggregator** (`src/backtest/aggregator.ts`) — 15m → 1H/4H/1D candle aggregation.
2. **Binance data pipeline** — 24 months downloaded (71K rows), CSV parser with microsecond→ms fix.
3. **Backtest corrections** — Fee fix (0.035%→0.045%), hourly funding rate, configurable PMARP, per-strategy enable/disable.
4. **PMARP parameter sweep** — (50,200) vs (20,350) vs (50,100) across 484 days. **KB params (20,350) are optimal.** Fixed defaults.
5. **S1+S2 confirmation backtest** — +$81.24 (+16.2%), Sharpe 3.55, max DD -4.8% over 379 days. S3 confirmed dead (556 trades, 29% win, -$60).

### Phase 1: Headless Bot
6. **Promoted indicators** to `src/indicators/calculator.ts` (shared by both bots + backtest).
7. **WebSocket candle consumer** (`src/ws/candle-consumer.ts`) — 15m subscription, 600-bar buffer, bar-close detection, heartbeat/reconnect, REST gap-fill.
8. **Headless entry point** (`src/main-headless.ts`) — Event-driven, PMARP (20,350), source tagging.

### Supabase + Architecture
9. **Source separation** — `source` column on market_snapshots, risk_snapshots, positions. `target` on bot_commands. Risk state hydration filters by source.
10. **Migration script** + colleague ran SQL successfully.
11. **Architecture decision:** VPS bot = production, TV desktop bot = demo/Krown only.

### Wallet Separation (Option A)
12. **New master wallet:** `0x5642A41938903483486085D3672535e3a7044110` ($399 USDC)
13. **New agent wallet:** `0x483dd299871d13551AD687E39c3F2Cd40D649369`
14. Fully independent from desktop bot master (`0x3a8a...`).

### VPS Deployment (LIVE)
15. **Deployed to OCI ARM #2** (`170.9.253.98`) via pm2 (id=5, `trading-bot`).
16. **All 3 strategies enabled** at 0.25x leverage (S1=2.5x, S2=2.0x, S3=1.3x) for data collection.
17. **Discord notifications** in `#tradekit` — trade entries/exits, errors, status digest every 2h.
18. **Tested locally + on VPS** — WebSocket, indicators, Supabase, commands all verified.

### Commits (10+, all pushed to main)
Key commits: `d397500` (Phase 0), `8d7e458` (PMARP fix), `e1900b3` (Phase 1), `cbc26ee` (source separation), `857fb33` (reduced leverage), `6ab3b39` (Discord), `77a414e` (2h digest).

## What Was Done (Session 22) — Fix 422 leverage error + S3 diagnostics

1. **Fixed 422 leverage error** — Hyperliquid API rejects non-integer leverage. The 0.25x multiplier produced decimals (e.g. S3: 5×0.25=1.25→1.3x). Changed to `Math.round()` for integers (S3→1x, S2→2x, S1→3x). File: `src/main-headless.ts`. Committed: `334b47d`.
2. **Added S3 diagnostic logging** — Every StochRSI cross now logs all filter conditions (BBWP, OB/OS, EMA21 proximity, RSI range) with pass/fail flags. Will reveal why signals are so rare vs desktop bot. File: `src/strategy/s3_stoch_rsi.ts`. Committed: `334b47d`.
3. **Deployed to VPS** — `git pull && npm run build && pm2 restart trading-bot`. Bot confirmed running with new code.

**Key finding:** The bot DID generate a signal at 06:45 UTC on 2026-04-23 but failed at `ensureLeverage` with HTTP 422 before placing the order. The leverage fix should unblock actual trade execution.

**Open question:** Are locally-computed indicators diverging from TradingView? S3 generated ~1.15 trades/day in backtest but nearly zero live. Diagnostics will answer this.

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-04-21 | VPS bot LIVE on OCI2 | Running with $399, 0.25x leverage, all 3 strategies. Monitor Discord #tradekit for trades/errors. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 30 --nostream"` |
| 2026-04-14 | Desktop bot needs restart for commit `0155e74` | Running pre-reconciliation code. Low priority now — VPS bot is the main bot. | Ctrl+C PS window → `$env:DRY_RUN="false"; npm start` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Check S3 diagnostics (~1h after deploy)** | low | SSH into VPS, grep for `[S3-diag]`. See which filters block signals most. |
| 2 | **Investigate indicator divergence if diagnostics show issues** | med | If BBWP/StochRSI values look wrong vs TradingView, run `validate_indicators.ts`. |
| 3 | **Relax S3 thresholds if market regime is the blocker** | med | If BBWP consistently >40, consider raising S3_BBWP_MAX. Backtest first. |
| 4 | **Scale up leverage after 10-15 trades** | low | Change `LEVERAGE_MULT=1.0` in VPS `.env` → `pm2 restart trading-bot` |
| 5 | **S2 entry tuning** | med | S2 at 40% win rate. Investigate losing trades — tighter BBWP or PMARP threshold? |
| 6 | **S1 entry loosening** | med | Only ~10 trades/year. Can EMA alignment be relaxed? |
| 7 | **New strategy development** | med | Colleague finds setups on TV → writes rules → we code + backtest → deploy. |
| 8 | **Desktop bot for Krown demo** | low | Already works. Run with `DRY_RUN=true` when needed for presentation. |
