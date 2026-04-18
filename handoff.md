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

## What Was Done (Session 17) — Backtests page + pagination fix

1. **Fixed Hyperliquid 429 rate limiting** — `src/backtest/collector.ts`: changed parallel TF fetching to sequential, added retry with backoff (5 attempts: 3s/8s/20s/40s/60s), 1.5s sleep between paginated pages, 3s gap between timeframes.
2. **Fixed pagination bug (critical)** — The API anchors responses to `endTime` and returns the most-recent N bars, so forward pagination (`cursor = lastTs + 1`) always returned the same trailing ~5000 15m bars (~49 days) regardless of `--days`. Fixed by backwards pagination: `windowEnd = firstTs - 1` after each page. Both runs now cover their full requested window with distinct trade data.
3. **`reporter.ts` — per-run file saving** — Results now saved to `backtest-results/{days}d-{YYYYMMDD}-{HHmmss}.json` (never overwritten). Legacy `backtest-results.json` still written for backward compat. Directory created at `TradingBot/backtest-results/`.
4. **Frontend Backtests page** — `frontend/src/app/(app)/backtests/page.tsx`: SSR loader reads all JSON files from `backtest-results/` directory, sorts newest-first, passes to `BacktestTabs`. Auto-picks up new runs on page refresh — no code changes needed.
5. **`BacktestTabs` component** — `frontend/src/components/backtest-tabs.tsx`: Client Component, one tab per run (label `{days}d · {date}`), config badges, 6 stat cards, strategy breakdown table, full trade log sorted newest-first.
6. **Nav updated** — Desktop nav: "Backtests" link added. Mobile nav: "Strategy" tab replaced with "Backtest" (`FlaskConical` icon).
7. **Backtest runs executed** — 90d (113 trades, S2 +$12.99, total -$5.93) and 365d (correct full-window data, different trade count/distribution vs 90d) both saved to `backtest-results/`. Old broken runs from before the pagination fix also present as earlier tabs.

## What Was Done (Session 18) — S3 overtrading fix, Supabase backtests, native close detection

1. **S3 overtrading analysis** — Backtest data (90d, 102 S3 trades) analysed in depth: 29% win rate, -$11.92 PnL. All `stoch_rsi_reverse_cross` exits at ≤45min were losses (15 trades, -$3.75). `max_hold_time` exits had 87.5% win rate. tp2/tp3 never reached.
2. **S3 entry filter: BBWP < 40** — `src/strategy/s3_stoch_rsi.ts`: added `S3_BBWP_MAX = 40` constant. Blocks S3 entries when 1H BBWP ≥ 40 (high-volatility = StochRSI crosses are noise).
3. **S3 exit filter: 45min min hold** — `src/strategy/s3_stoch_rsi.ts`: added `S3_MIN_HOLD_MS = 45 * 60 * 1000`. Gates `stoch_rsi_reverse_cross` exit behind minimum hold time.
4. **Backtest validation** — 90d re-run: S3 trades 102→46 (-55%), total PnL -$5.93→-$0.84, max DD -2.6%→-1.7%, profit factor 0.86→0.97, Sharpe -0.89→-0.00. S1/S2 unchanged.
5. **Backtest results in Supabase** — New `backtest_runs` table (30 columns). `saveToSupabase()` in `src/backtest/reporter.ts`. Migration script at `src/scripts/migrate_backtest_runs.ts`. RLS policy added.
6. **Backtests page reads from Supabase** — `frontend/src/app/(app)/backtests/page.tsx` rewritten from local filesystem reads to Supabase queries. Works on Vercel production.
7. **Dashboard layout** — Manual Trade card moved from below Recent Ticks to right below the 4 stat cards for quicker access.
8. **Native TP/SL close detection** — `reconcilePositions()` in `src/main.ts`: compares `activePositions[]` against live Hyperliquid positions each tick. When a position disappears, fetches real fill price from `getUserFills()`, computes actual PnL, calls `insertClosedTrade()`. Heuristic: profit = `native_tp`, loss = `native_sl`.
9. **Manual trade position tracking** — `CommandHandlerContext.registerManualPosition()` callback added. `handleManualTrade` now pushes into `activePositions[]` after confirmed fill, so the reconciliation loop can detect native closes and log them.
10. **3 commits pushed** — `191c1e5` (S3 fix + backtests page), `981b714` (Supabase storage + dashboard), `0155e74` (reconciliation + manual trade tracking).

## What Was Done (Session 19) — VPS deployment planning

1. **VPS deployment planning docs** — Created `IMPLEMENTATION_PLAN.md` and `docs/` with deployment roadmap for moving the bot from local PowerShell to a VPS. Implementation roadmap, cost analysis, and architecture decisions documented.
2. **Final handoff document + memory entries** — Updated handoff.md, decision log, session summary.
3. **No bot code changes** — LIVE bot still running pre-reconciliation Session 18 code.

## What Was Done (Session 20) — Knowledge architecture restructuring

1. **Created `CLAUDE.md`** — Permanent project context (architecture, key files, conventions, risk config, security rules, untested paths) extracted from handoff.md. Auto-loaded every message (~135 lines).
2. **Created `docs/session-archive.md`** — Sessions 1-16 moved to cold storage (808 lines). Never read by `/start`.
3. **Trimmed `handoff.md`** — From 1138 lines to ~200. Only last 3 sessions + Watchlist + What To Do Next.
4. **Updated `/start` skill** — Reads last ~200 lines of handoff.md instead of the full file.
5. **Initialized memory system** — Key project decisions and user preferences.

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-04-14 | Bot needs restart for commit `0155e74` | Running pre-reconciliation code. Native TP/SL detection + manual trade tracking not active. | Ctrl+C PS window → `$env:DRY_RUN="false"; npm start` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Restart bot with reconciliation code** | low | Current instance pre-commit `0155e74`. Pick up native TP/SL detection + manual trade tracking. |
| 2 | **Verify manual trade Supabase logging** | low | Place manual trade from dashboard, let TP/SL fire, confirm on Trades page with `source: "manual"` + correct exit price. |
| 3 | **Further S3 tuning** | med | Still net negative (-$6.88/46 trades). Options: trade cooldown, tighter RSI range, require 1H trend alignment. Backtest each before deploying. |
| 4 | **Multi-asset support (ETH/SOL)** | high | New TV charts + indicators, strategy params per asset, dynamic asset index, risk manager changes. Major expansion. |
| 5 | Tighten RLS policies | low | Gate INSERT/UPDATE/DELETE on `auth.uid()` for user-controlled tables. Must-do before multi-user. |
| 6 | Install `jq` for safety hooks | low | `winget install jqlang.jq` + restart VS Code. `protect-files.sh` already works without it. |
| 7 | Frontend command execution toast | trivial | Show "Kill command sent…" immediately, then replace with result toast. |
| 8 | Add `[Portfolio]` prefix to portfolio logs | trivial | Cosmetic — portfolio stats default to source `main` in bot_logs. |
