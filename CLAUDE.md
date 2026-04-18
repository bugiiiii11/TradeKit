# TradeKit — Project Guide

> Auto-loaded every message. Keep under 200 lines. Permanent project context only.
> Session-specific work goes in `handoff.md`. Historical sessions in `docs/session-archive.md`.

## Current State

- **Bankroll:** ~$500.26 USDC on Hyperliquid mainnet (Perps account)
- **Master wallet:** `0x3a8a318097017aCE0db8276ea435F26DE8674C46` (MetaMask)
- **API wallet:** `0x1BDd4abA4232e724a28dda11b0584Db6F1eDb8aD` (trade-only, no withdraw)
- **Network:** mainnet | **Mode:** LIVE
- **Strategy:** BTC perps, 3 strategies (S1/S2/S3), multi-TF confluence
- **Leverage:** S1=10x, S2=8x, S3=5x | **Sizing:** 5% margin-based
- **GitHub:** `github.com/bugiiiii11/TradeKit` | **Vercel:** `trade-kit.vercel.app`
- **Supabase:** project `gseztkzguxasfwqnztuo` | 11 tables, RLS enabled

## Architecture

```
TradingView Desktop (BINANCE:BTCUSDC, 9 indicators, CDP port 9222)
        │
tradingview-mcp (Node child process, stdio MCP)
        │
Trading Bot (src/main.ts, 15-min loop)
        │ Strategy eval → risk gate → margin sizing → order
Hyperliquid SDK @nktkas/hyperliquid (viem wallet, isolated margin)
        │
Hyperliquid mainnet
```

## Key Files

**Bot core:** `src/main.ts` (main loop + reconciliation), `src/mcp/client.ts` (MCP with retry/reconnect), `src/tradingview/reader.ts` (multi-TF snapshots)

**Hyperliquid:** `src/hyperliquid/client.ts` (SDK init), `account.ts` (balance, positions, funding, fills), `orders.ts` (market/limit, SL/TP, scaled TPs, stop cleanup, isolated margin)

**Strategy:** `s1_ema_trend.ts` (4H EMA8/55 cross + Daily macro), `s2_mean_reversion.ts` (1H EMA55 retest, BBWP<35, PMARP), `s3_stoch_rsi.ts` (15m StochRSI, BBWP<40 filter, 45min min hold), `confluence.ts` (scoring + EMA200 macro filter + per-strategy leverage)

**Risk:** `manager.ts` (drawdown limits, pause, position cap=3), `sizing.ts` (calcMarginBasedSize: 5% margin), `state.ts` (bankroll/PnL tracking, Supabase hydration on restart)

**Database:** `src/db/` — `supabase.ts` (singleton), `snapshots.ts` (market+risk writes + hydration read), `positions.ts` (sync by coin_direction key), `trades.ts` (closed trades, source: bot|manual), `logs.ts` (console→ring buffer→Supabase batch), `commands.ts` (Realtime subscription + claim-then-execute)

**Commands:** `src/commands/handlers.ts` — kill_switch, resume, manual_trade

**Backtest:** `src/backtest/` — `collector.ts` (Hyperliquid candle API), `indicators.ts` (EMA/RSI/StochRSI/BBWP/PMARP), `aligner.ts` (multi-TF alignment), `engine.ts` (strategy replay + fees), `reporter.ts` (stats + Supabase storage). CLI: `src/scripts/backtest.ts`

**Frontend** (Next.js 16 + React 19 + Tailwind v4 + shadcn base-nova):
- Pages: dashboard, market-data, trades, strategies, automation, backtests (all under `(app)` route group)
- Components: `manual-trade-card.tsx`, `kill-switch-button.tsx`, `mobile-nav.tsx`, `backtest-tabs.tsx`
- Auth: email/password login at `/login`, proxy-based auth check
- Supabase clients: `lib/supabase/client.ts` (browser), `server.ts` (SSR), `proxy.ts` (auth)
- Config: `frontend/next.config.js` (CJS only — see Conventions)

**Config & docs:** `BTC_TRADING_STRATEGY_KB.md` (strategy source of truth), `.env` (secrets — NEVER read/commit), `launch_tradingview.ps1` (TV with CDP), `FRONTEND_ANALYSIS.md` (frontend architecture)

## Test Scripts

All in `src/scripts/`. Run with `npx ts-node src/scripts/<name>.ts`.

| Script | Purpose |
|--------|---------|
| `test_connection.ts` | Hyperliquid read-only smoke test |
| `test_dry_run.ts` | Full pipeline one-shot (no orders) |
| `test_micro_trade.ts` | $20 market entry + close (`long`\|`short` arg) |
| `test_stop_loss.ts` | $20 entry + SL + verify + cancel (`long`\|`short` arg) |
| `test_limit_order.ts` | GTC limit both directions + cancel |
| `test_stop_cleanup.ts` | Validates closePosition auto-cleanup of stops |
| `test_risk_hydration.ts` | 5-case risk state hydration test |
| `test_custom_trade.ts` | CLI manual trade with SL + scaled TPs |
| `backtest.ts` | Strategy replay: `--days 90 --bankroll 500 --margin 5` |

## Conventions

- **shadcn base-nova** uses `render={<Component />}` prop, NOT Radix `asChild`
- **Next 16:** `proxy.ts` replaces `middleware.ts`; `cookies()`/`headers()` are fully async
- **next.config.js MUST be CJS** (`.js` with `__dirname`). Never `.ts` — causes OOM crash-loop on Windows (Session 11 incident: 3h LIVE bot outage + laptop freeze)
- **Supabase keys:** new format (`sb_publishable_...` / `sb_secret_...`). Legacy JWTs fully disabled.
- **Command bus pattern:** frontend inserts `bot_commands` row → Supabase Realtime → bot claims atomically (`UPDATE WHERE status='pending'`) → executes → writes result back
- **DRY_RUN gate:** `src/main.ts` skips order placement when `DRY_RUN=true`
- **Margin sizing:** 5% of bankroll as margin, leverage applied on top. Portfolio compounds each trade.

## Untested Code Paths

**Trade execution (first LIVE trade will exercise):**
- `insertClosedTrade` + `syncPositions` upsert/stale-delete — no LIVE trade has closed yet
- `calcMarginBasedSize` / per-strategy leverage / S3 scaled TPs under live conditions
- Kill switch close-all with real open LIVE positions
- Native TP trigger execution + partial fill cascade on Hyperliquid
- Reconciliation (`reconcilePositions`) — code pushed but bot not yet restarted with it
- Stop-placement retry on entry failure — NOT IMPLEMENTED (position briefly naked if SL placement fails)

**Operational:**
- Command handler failure path (`status='failed'` write-back)
- MCP reconnect under real TradingView crash (only synthetic retry tested)
- Log sink `beforeExit` flush + buffer overflow drop-oldest
- `cancelOpenBtcStops` "canceled > 0" branch (Hyperliquid removes stops natively)

**Frontend edge cases:**
- Proxy session-refresh cookie write, sign-out button, error page, 15s action timeout
- Backtest S2 BBWP/PMARP accuracy vs live TV chart indicator settings

## Risk Configuration

**Portfolio:** max concurrent=3, max exposure=60%, daily DD=10%→24h pause, weekly DD=15%→48h pause, consecutive losses=3→4h pause

**Per-trade:** 5% margin × strategy leverage (S1: 10x→$250, S2: 8x→$200, S3: 5x→$125 notional at $500 bankroll)

## Background Processes

- **TradingView Desktop** — CDP port 9222. Relaunch: `launch_tradingview.ps1`. Loses state on Windows sleep.
- **LIVE bot** — PowerShell window, 15-min ticks. Check handoff.md for current code version status.
- **tradingview-mcp** — child process of bot, dies with bot
- **Supabase Realtime** — bot holds WebSocket channel for `bot_commands` INSERT events
- **Vercel** — `trade-kit.vercel.app`, auto-deploys on push to `main`
- **Safety hooks** — `protect-files.sh` active (blocks `.env*` edits). Others need `jq` (`winget install jqlang.jq`).

## Security Rules

- `.env` API wallet key is trade-only (no withdraw) — NEVER read, NEVER commit
- `SUPABASE_SERVICE_ROLE_KEY` bypasses ALL RLS — bot `.env` only, NEVER in frontend
- Frontend uses `sb_publishable_...` key (designed to be public, RLS enforced)
- Hook `protect-files.sh` blocks Claude from editing `.env*` files
- RLS policies are `always_true` for single-user — MUST tighten before adding users
- Main MetaMask private key must NEVER go in `.env` (has full withdrawal permissions)

## Resuming

1. Open a new Claude Code chat
2. Type `/start` — reads handoff.md + checks environment + presents session briefing
