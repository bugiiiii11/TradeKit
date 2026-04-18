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

## What Was Done (Session 19) — VPS deployment planning

1. **VPS deployment planning docs** — Created `IMPLEMENTATION_PLAN.md` and `docs/` with deployment roadmap for moving the bot from local PowerShell to a VPS.
2. **Final handoff document + memory entries** — Updated handoff.md, decision log, session summary.
3. **No bot code changes** — LIVE bot still running pre-reconciliation Session 18 code.

## What Was Done (Session 20) — Knowledge architecture restructuring

1. **Created `CLAUDE.md`** — Permanent project context extracted from handoff.md. Auto-loaded every message.
2. **Created `docs/session-archive.md`** — Sessions 1-16 moved to cold storage.
3. **Trimmed `handoff.md`** — From 1138 lines to ~200.
4. **Initialized memory system** — Key project decisions and user preferences.

## What Was Done (Session 21) — Phase 0 validation + Phase 1 headless bot

**Major session: built the complete VPS headless bot pipeline from scratch.**

### Phase 0: Validation Infrastructure
1. **TimeframeAggregator** (`src/backtest/aggregator.ts`) — 15m → 1H/4H/1D candle aggregation, reusable for live WebSocket.
2. **Indicator validation script** (`src/scripts/validate_indicators.ts`) — compares local indicators vs TradingView + PMARP parameter sweep. Blocked: needs TradingView Desktop (colleague to run).
3. **Binance data pipeline** — `download_binance.ts` (24 months downloaded, 71K rows) + `binance-loader.ts` (CSV parser with microsecond→ms fix, TF aggregation).
4. **Backtest corrections** — Fee fix (0.035%→0.045% taker, 0.09% RT), hourly funding rate modeling, configurable PMARP params, per-strategy enable/disable.
5. **PMARP parameter sweep** — Tested (50,200), (20,350), (50,100) across 484 days. KB params (20,350) are optimal: portfolio Sharpe -0.42→+0.57. **Fixed defaults to (20,350).**
6. **S1+S2 confirmation backtest** — With S3 disabled + PMARP (20,350): +$81.24 (+16.2%), Sharpe 3.55, max DD -4.8% over 379 days.

### Phase 1: Headless Bot
7. **Promoted indicators** — `src/indicators/calculator.ts` (shared by both bots + backtest). Old `backtest/indicators.ts` re-exports.
8. **WebSocket candle consumer** (`src/ws/candle-consumer.ts`) — 15m subscription via SDK `SubscriptionClient`, 600-bar buffer, bar-close detection (t-field advancing), heartbeat (30s), reconnect on 60s stale, REST gap-fill.
9. **Headless entry point** (`src/main-headless.ts`) — Event-driven (on bar close), ENABLED_STRATEGIES env var (default S1,S2), PMARP (20,350) hardcoded, source tagging.
10. **Tested locally** — `DRY_RUN=true npm run start:headless` — REST warmup, WS subscribe, indicator computation, strategy evaluation all working.

### Supabase Source Separation
11. **Source tagging** — `market_snapshots`, `risk_snapshots`, `positions` get `source` column. `bot_commands` gets `target` column. `loadLatestRiskState()` filters by source.
12. **Migration script** (`src/scripts/migrate_source_columns.ts`) — SQL ready. **Must run in Supabase SQL Editor before deploying VPS bot.**

### Docs & Config
13. **CLAUDE.md updated** — Two-bot architecture, headless infra, PMARP fix, S3 disabled, new scripts.
14. **Implementation plan rewritten** — `docs/IMPLEMENTATION_PLAN.md` reflects two-bot architecture (additive, not replacement).
15. **npm script added** — `npm run start:headless`

### Key Findings
- **S1 is the best strategy** — +$63-81 over 379-484 days, 57-70% win rate, but only ~10-14 trades/year.
- **S2 nearly breakeven** with correct PMARP (20,350) — was -$29 with wrong params, now -$0.49.
- **S3 is confirmed dead** — 556 trades, 29% win rate, -$60. Disabled.
- **Two-bot architecture** — VPS bot is additive, separate wallet, shared Supabase.

### Commits (5, all pushed)
- `d397500` Phase 0: validation infrastructure + two-bot architecture
- `8d7e458` PMARP fix (50,200→20,350) + strategy enable/disable + parameter sweep
- `e1900b3` Phase 1: headless entry point + WebSocket candle consumer
- `cbc26ee` Supabase source separation for two-bot architecture
- `06f5f49` Migration script + npm start:headless + CLAUDE.md update

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-04-14 | Desktop bot needs restart for commit `0155e74` | Running pre-reconciliation code. Native TP/SL detection + manual trade tracking not active. | Ctrl+C PS window → `$env:DRY_RUN="false"; npm start` |
| 2026-04-18 | Supabase migration pending | Source/target columns not yet added. VPS bot will fail on Supabase writes until migration runs. | Run SQL from `migrate_source_columns.ts` in Supabase SQL Editor |
| 2026-04-18 | TradingView indicator validation pending | Blocked on colleague having TV Desktop. Confirms local indicators match chart. | Colleague runs `validate_indicators.ts` with TV + CDP |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Run Supabase migration** | low | Paste SQL from `migrate_source_columns.ts` into SQL Editor. Required before VPS bot goes live. |
| 2 | **Restart desktop bot** | low | Still running pre-reconciliation code from Session 18. |
| 3 | **Create VPS API wallet** | low | Colleague creates new Hyperliquid agent wallet, funds with $500. |
| 4 | **TradingView indicator validation** | low | Colleague runs `validate_indicators.ts`. Confirms PMARP (20,350) matches chart. |
| 5 | **Deploy headless bot to OCI VPS** | med | Clone repo, `npm install`, `.env.vps` with new wallet key, `pm2 start`. |
| 6 | **Phase 2: testnet paper trading** | med | Run VPS bot on testnet for 2-3 weeks, >15 trades. |
| 7 | **S2 entry tuning** | med | S2 at 40% win rate with correct PMARP. Investigate losing trades — tighter BBWP or PMARP threshold? |
| 8 | **S1 entry loosening** | med | Only ~10 trades/year. Can EMA alignment be relaxed (3 of 4 instead of all 4)? |
