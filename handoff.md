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

## What Was Done (Session 27) — Health check + leverage scale-up

### VPS Health Check
Bot healthy: 42h uptime, 0 unstable restarts, error log empty. WS listener leak fix holding — no crash/reconnect loops. 86 bar closes processed. One S2 long @ $78,474 closed at +$0.84 (+4.21%). Balance: $397.30 → $398.14. BBWP 92-96 (extreme vol expansion) correctly blocking most entries. Hydration never fired (no WS crashes required restart).

### Leverage Scale-Up
Changed `LEVERAGE_MULT` from 0.25 to 0.5 in VPS `.env`. Restarted with `pm2 restart trading-bot --update-env`. Bot startup clean, warmup loaded (1500 15m + 251 4H + 251 1D bars). Effective leverage now: S1=5x, S2=4x (on 5% margin). Next trades will be ~double previous size.

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

### Conclusion
Both S3 (scalp) and S4 (grid) confirm: **BTC perps favor trend-following (S1, S2), not mean-reversion.** S4 code preserved for future experiments on mean-reverting instruments. Full analysis in `docs/s4-grid-backtest-analysis.md`.

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-05-06 | S1+S2 only at 0.5x leverage | S3 disabled (Session 28), S4 not viable (Session 29). Monitor S1/S2 trade quality. Balance ~$399. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 30 --nostream"` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Scale to full leverage (1.0x)** | low | Currently at 0.5x. After ~10-15 trades at 0.5x with S1+S2 only, bump to 1.0x. Same process: edit `.env` + `pm2 restart --update-env`. |
| 2 | **Martin's TV setups → manual trades** | med | Most promising new alpha source. Manual trade infra is ready (Session 28 fix). S1 filter toggle ready. Colleague finds setups on TV → writes rules → we code + backtest → deploy. |
| 3 | **S1 filter toggle from dashboard** | med | Frontend button to flip `S1_SKIP_DAILY_EMA200` without SSH. Enables Martin to react to Krown-type signals quickly. |
| 4 | **S5 trend-following strategy** | med | New entry signals, same "ride the trend" structure as S1. Both S3+S4 confirm BTC perps favor trend-following, not mean-reversion. |
| 5 | **S3 re-evaluation** | low | S3 disabled (net -$82, PF 0.51). Code intact, re-enable via `ENABLED_STRATEGIES=S1,S2,S3`. Worth revisiting if Martin fine-tunes StochRSI parameters. |
| 6 | **TradingView indicator validation** | low | Compare local vs TV values. Run `validate_indicators.ts` when TV Desktop available. |
