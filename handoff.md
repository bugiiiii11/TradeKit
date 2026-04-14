# TradingBot — Session Handoff

> Single source of truth for resuming work across chat sessions.
> Updated by `/wrap`. Read by `/start` at the beginning of each session.

## Current State

- **Bankroll:** ~$499.47 USDC on Hyperliquid mainnet (Perps account) — minor test trade fees deducted in Session 13. No strategy-driven LIVE trades have fired yet; all ticks result in `No signals this tick` (bearish macro, confluence 0/3).
- **Master wallet:** `0x3a8a318097017aCE0db8276ea435F26DE8674C46` (MetaMask)
- **API wallet (agent):** `0x1BDd4abA4232e724a28dda11b0584Db6F1eDb8aD` (Hyperliquid — trade-only, no withdraw permission)
- **Network:** mainnet
- **Mode:** **LIVE** — Session 14+15 code running in PowerShell window. Clean startup: hydration confirmed, 3 ticks observed, all `No signals this tick`. Killed state: `false`. Isolated margin.
- **Strategy:** BTC perpetual futures, 3 strategies (S1/S2/S3), multi-timeframe confluence. Per-strategy fixed leverage (S1=10x, S2=8x, S3=5x), 5% margin-based sizing, S3 scaled TPs (1%/3%/5%). **Session 15: manual trade card on dashboard — place trades from browser via command bus.**
- **GitHub:** `github.com/bugiiiii11/TradeKit` — 13 commits, auto-deploys to Vercel
- **Vercel:** `trade-kit.vercel.app` — frontend dashboard (Next.js 16, Supabase auth). Sign-ups disabled — only existing account can log in.
- **Last session:** 15 — 2026-04-14 — **Manual trade card (dashboard → command bus → Hyperliquid).**

## Architecture

```
TradingView Desktop (BINANCE:BTCUSDC chart, 9 indicators)
        │ CDP on port 9222
        ▼
tradingview-mcp (Node child process, stdio)
        │ MCP tools: data_get_study_values, chart_set_timeframe, quote_get
        ▼
Trading Bot (src/main.ts)
        │ Strategy eval → risk gate → sizing
        ▼
Hyperliquid SDK @nktkas/hyperliquid
        │ viem wallet (API agent key)
        ▼
Hyperliquid mainnet
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | Main loop, DRY_RUN gate, 15-min interval |
| `src/mcp/client.ts` | Spawns tradingview-mcp as child process, stdio MCP client |
| `src/tradingview/reader.ts` | Multi-TF indicator snapshots (15m / 1H / 4H / 1D) |
| `src/hyperliquid/client.ts` | SDK init (viem wallet), BTC asset index resolution |
| `src/hyperliquid/account.ts` | `getBalance`, `getOpenPositions`, `getFundingRate` |
| `src/hyperliquid/orders.ts` | `placeMarketOrder`, `placeLimitOrder`, `setStopLoss`, `closePosition`, `cancelOrder` |
| `src/strategy/s1_ema_trend.ts` | 4H EMA8/EMA55 cross + Daily macro filter |
| `src/strategy/s2_mean_reversion.ts` | 1H EMA55 retest, BBWP < 35, PMARP filter |
| `src/strategy/s3_stoch_rsi.ts` | 15m Stoch RSI cross + 1H EMA21 proximity, 2h max hold |
| `src/strategy/confluence.ts` | Full confluence table + Daily EMA200 macro filter |
| `src/risk/manager.ts` | Drawdown limits, pause logic, concurrent position cap |
| `src/risk/sizing.ts` | Session 14 — `calcMarginBasedSize`: 5% of bankroll as margin, leverage applied on top. Replaced stop-distance-based sizing. |
| `src/risk/state.ts` | Bankroll, daily/weekly PnL, consecutive losses tracking |
| `BTC_TRADING_STRATEGY_KB.md` | Strategy KB — source of truth for strategy logic |
| `.env` | Secrets — NEVER read, NEVER commit |
| `.env.example` | Template for env vars (HYPERLIQUID_PRIVATE_KEY, HYPERLIQUID_WALLET_ADDRESS, HYPERLIQUID_NETWORK, BANKROLL, LOOP_INTERVAL_MS, DRY_RUN) |
| `launch_tradingview.ps1` | Launches TradingView with `--remote-debugging-port=9222` |
| `handoff.md` | This file |
| `FRONTEND_ANALYSIS.md` | Session 2 — full frontend architecture (5 pages, Supabase schema, command-bus pattern, Next.js 15 + shadcn/ui stack) |
| `.mcp.json` | Session 2 — Supabase HTTP/OAuth MCP server config (project-local) |
| `.claude/commands/skillscanner.md` | Session 2 — security auditor for future skill installs |
| `.claude/hooks/*.sh` | Session 2 — 5 safety hooks (block-dangerous, block-internal-urls, protect-files, scan-injection, audit-all). Inert until `jq` is installed. |
| `.claude/settings.local.json` | Session 2 — hook wiring (PreToolUse + PostToolUse matchers) |
| `.env` | NEW vars (Session 2): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (bot, trusted) |
| `frontend/.env.local` | Session 2 — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (no service role here, ever) |
| `src/db/supabase.ts` | Session 6 — lazy singleton Supabase client (service role). Graceful no-op if env vars missing. |
| `src/db/snapshots.ts` | Session 6 — `writeMarketSnapshot` + `writeRiskSnapshot`. Called once per tick. Macro filter label computed inline. |
| `src/db/positions.ts` | Session 6 — `syncPositions(hlPositions, marks)`. Upsert by `${coin}_${direction}` synthetic key, delete rows not in current set. Truncates to 0 when flat. |
| `src/db/trades.ts` | Session 6 — `insertClosedTrade(...)`. Writes one row on trade close with pnl_r and entry_conditions jsonb. `strategy_config_id` left null until frontend variants exist. |
| `src/db/logs.ts` | Session 6 — `initLogSink()` monkey-patches `console.log/warn/error` → ring buffer → Supabase batch every 2s. `beforeExit`/`SIGINT`/`SIGTERM` flush. Source detected from `[Prefix]` pattern, default `main`. Buffer cap 200 lines, drop oldest on overflow. |
| `frontend/` | Session 7 — Next.js 16 + React 19.2 + Tailwind v4 + shadcn/ui (`base-nova`/Base UI) + `@supabase/ssr`. App Router, `src/` layout. |
| `frontend/src/app/layout.tsx` | Session 7 — Root layout. ThemeProvider (dark default), Toaster, Geist fonts. `suppressHydrationWarning` on `<html>` for next-themes. |
| `frontend/src/app/page.tsx` | Session 7 — Dashboard (SSR, `export const dynamic = "force-dynamic"`). Fetches in parallel: latest 10 `market_snapshots`, latest 1 `risk_snapshots`, latest 20 `bot_logs`, all `positions`. Renders 4 stat cards (Bankroll / BTC Price / Confluence / Positions), recent ticks table, open positions list, log viewer. |
| `frontend/src/app/login/` | Session 7 — Magic link login. `page.tsx` (card UI), `login-form.tsx` (client component, `useActionState`), `actions.ts` (`sendMagicLink` server action calls `supabase.auth.signInWithOtp` with `emailRedirectTo: /auth/callback`). |
| `frontend/src/app/auth/callback/route.ts` | Session 7 — PKCE callback. Exchanges `?code=...` for session via `exchangeCodeForSession`, redirects to `next` param (default `/`). |
| `frontend/src/app/auth/signout/route.ts` | Session 7 — POST handler: `signOut()` + redirect to `/login`. Used by the header sign-out button. |
| `frontend/src/components/site-header.tsx` | Session 7 — Sticky header: logo, user email, theme toggle, sign-out button (form POSTs to `/auth/signout`). |
| `frontend/src/components/theme-provider.tsx` | Session 7 — `next-themes` wrapper (`"use client"`). |
| `frontend/src/components/theme-toggle.tsx` | Session 7 — Sun/Moon dropdown. Uses Base UI `render={<Button />}` prop (NOT Radix `asChild`). |
| `frontend/src/components/ui/*` | Session 7 — shadcn `base-nova` components: button, card, table, badge, dropdown-menu, sonner, skeleton, separator. Backed by `@base-ui/react`, not Radix. |
| `frontend/src/lib/format.ts` | Session 7 — `formatUsd`, `formatPrice`, `formatPercent`, `formatFundingRate`, `formatRelativeTime`, `formatTime`. All null-safe. |
| `frontend/src/lib/supabase/client.ts` | Session 7 — `createBrowserClient` for Client Components. Reads `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. |
| `frontend/src/lib/supabase/server.ts` | Session 7 — Async `createClient()` for Server Components / Actions / Route Handlers. Uses `await cookies()` (Next 16 mandatory). `setAll` is wrapped in try/catch to swallow Server Component cookie-write errors. |
| `frontend/src/lib/supabase/proxy.ts` | Session 7 — `updateSession(request)`: creates a proxy-scoped Supabase client, calls `supabase.auth.getUser()` (NOT `getSession()` — the latter doesn't verify against the server), refreshes cookies, redirects unauthed users to `/login`. |
| `frontend/src/proxy.ts` | Session 7 — **Next 16 replacement for `middleware.ts`.** Function exported as `proxy` (not `middleware`). Matcher excludes static assets + image files. Runs in nodejs runtime only (edge not supported for proxy in v16). |
| `frontend/.env.local` | Session 7 — `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`). User-created, not committed. |
| `frontend/components.json` | Session 7 — shadcn config. `style: base-nova`, `baseColor: neutral`, Tailwind v4, css vars. |
| `src/commands/handlers.ts` | Session 8 — `handleKillSwitch` (fetches HL open positions, closes each via `closePosition`, flips `killed` flag via `setKilled`, writes immediate risk snapshot) + `handleResume` (clears flag, immediate snapshot). DRY_RUN-aware. Returns typed `CommandResult` that the dispatcher writes back to the row. |
| `src/db/commands.ts` | Session 8 — `startCommandSubscription(ctx)`: startup sweep of `status='pending'` rows + Supabase Realtime `postgres_changes` subscription on `bot_commands` INSERT. Implements claim-then-execute (atomic `UPDATE status='running' WHERE id=$1 AND status='pending'`) to prevent double-processing. Also `stopCommandSubscription` for graceful shutdown. |
| `frontend/src/app/actions/commands.ts` | Session 8 — `"use server"` module. `issueCommand(type, payload)` inserts a `bot_commands` row THEN polls `bot_commands.status` every 150ms until terminal (`done`/`failed`/timeout at 15s). Only revalidates after the bot finishes → single-click UX. Typed wrappers `killSwitch(reason)` and `resumeBot()`. |
| `frontend/src/components/kill-switch-button.tsx` | Session 8 — Client Component, `useTransition` + sonner toast. Destructive red button when active, default green "Resume" button when killed. Uses `window.confirm` for kill confirmation (shadcn alert-dialog is follow-up polish). |
| `src/hyperliquid/orders.ts` | Session 9 — Added `cancelOpenBtcStops()` helper (filters `openOrders` for `coin==="BTC" && reduceOnly===true`, batch-cancels). Embedded in `closePosition` both on the empty-position early-return path AND after a successful close. Both wrapped in try/catch so cleanup failure never masks a successful close. Observation from test_stop_cleanup: Hyperliquid natively removes reduce-only trigger orders when the position closes, so our helper runs as a safety net and typically finds 0 orders to cancel. |
| `src/main.ts` | Session 9 — Added the **week-1 LIVE clamp block** right after `scoreSignals`: `confluence.leverage` clamped to 2x max, `confluence.riskPercent` clamped to 1% max, with explicit `[Bot] Week-1 cap: ...` log lines when clamping fires. Block is marked TEMP and must be removed after first LIVE week. / Session 11 — Added `hydrateRiskState()` call between `createMCPClient()` and `startCommandSubscription()` — pulls the newest `risk_snapshots` row and populates `_state` so restarts don't wipe the daily drawdown budget. Wrapped in try/catch with fresh-state fallback and an explicit log line summarizing the hydrated values. |
| `src/risk/manager.ts` | Session 9 — `MAX_OPEN_POSITIONS: 3 → 1` as a TEMP week-1 cap (KB default is 3). Doc comment updated. All other caps unchanged (60% exposure, 10%/15% daily/weekly drawdown, 3 consecutive losses). |
| `src/risk/state.ts` | Session 11 — Added exported `hydrateState(h: RiskStateHydration)` function. Handles cross-day/cross-week period resets (zeros dailyPnl + dailyStartBankroll on cross-midnight restart, same for week), clamps expired `pausedUntil` to 0, preserves `killed`/`killedReason` verbatim, leaves `openPositions`/`totalExposureUsd` at 0 so they get refreshed from Hyperliquid on first tick. |
| `src/db/snapshots.ts` | Session 11 — `writeRiskSnapshot` now persists `daily_start_bankroll` column (migration 008). New `loadLatestRiskState()` reader returns `HydratedRiskState \| null` — reads newest row via `.maybeSingle()`, handles null columns via a `toNumber()` helper with fallback, never throws. Called once on bot startup from `main.ts`. |
| `src/scripts/test_risk_hydration.ts` | Session 11 — 5-case test script (1 integration + 4 unit). Part A: insert synthetic `risk_snapshots` row → `loadLatestRiskState()` → `hydrateState()` → assert all fields → delete synthetic row. Parts B-E: call `hydrateState()` directly with crafted inputs to verify cross-day reset, expired/future `pausedUntil` handling, kill state preservation. Cleans up after itself. |
| `frontend/next.config.js` | **Session 11 — REPLACEMENT** for `next.config.ts`. CJS format using `__dirname` for `turbopack.root`. Rationale: Next 16 compiles `next.config.ts` to CJS output but invokes it in an ESM-ish context, so neither `import.meta.url` (Session 10 attempt) nor `process.cwd()` (Session 11 follow-up attempt) resolve the frontend path reliably. Using a plain `.js` file with `__dirname` matches the canonical example in `frontend/node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopack.md` exactly and works first-try. Closes task #22. Session 10's `next.config.ts` was deleted. |
| `frontend/src/app/(app)/layout.tsx` | Session 11 — Shared layout for authenticated app pages. Renders `<SiteHeader email={user?.email} />` + a `<main>` wrapper with max-w-7xl container padding. Fetches user via server-side Supabase client. Auth is already enforced upstream in `src/proxy.ts` — this layout just reads the email for the header. Route group `(app)` does not affect URLs. |
| `frontend/src/app/(app)/page.tsx` | Session 11 — Dashboard, moved from `src/app/page.tsx`. Removed its own `<SiteHeader>` render and outer `<main>` wrapper (both now in the layout). All fetches, stat cards, recent ticks table, positions card, log viewer, and kill-switch button unchanged from Session 7. Still `dynamic = "force-dynamic"`. |
| `frontend/src/app/(app)/automation/page.tsx` | Session 11 — Bot command history viewer. Reads latest 100 `bot_commands` rows ordered by `issued_at DESC`. Renders 4 stat cards (Total / Succeeded / Failed / Last 24h + in-flight count) and a table with Issued (absolute + relative), Type badge (kill_switch=destructive, resume=default, other=secondary), Status badge, Duration (finished_at − started_at in ms/s), Reason (extracted from payload.reason or result.reason), Result summary (e.g. "Closed 0 positions (dry-run)"). |
| `frontend/src/app/(app)/trades/page.tsx` | Session 11 — Closed trade history. Reads latest 100 `trades` rows. 4 stat cards (Total PnL tone-colored, Win Rate, Avg R, Best/Worst). Table with Closed time, Symbol, Side badge, Size, Entry/Exit, PnL, R, Exit Reason. Rich empty state explaining the first-LIVE-close workflow (important — `trades` table is still empty). Handles mixed string/number PnL values via a `toNumber` helper. |
| `frontend/src/app/(app)/strategies/page.tsx` | Session 11 — 3-strategy overview. Reads `strategy_templates` + `strategy_configs` + `trades` in parallel, joins trades to templates via `strategy_configs.template_id`. Per-template card: icon (S1=Layers, S2=BookOpen, S3=Zap), name, template ID badge, description, live stats (Trades / Win Rate / PnL), and top 6 Key Parameters pulled from `param_schema.groups` with priority order risk → timeframes → entry → exit. |
| `frontend/src/components/main-nav.tsx` | Session 11 — Client Component, renders 4 `<Link>` nav items (Dashboard / Trades / Strategies / Automation) with active-state highlighting via `usePathname()`. Active state logic: `/` is exact-match, others use `startsWith`. Hidden below `md` breakpoint via `hidden md:flex` — mobile hamburger is a follow-up polish task. |
| `frontend/src/components/empty-state.tsx` | Session 11 — Shared empty-state helper for the new pages (Trades "No trades yet", Automation "No commands yet"). Takes icon + title + description + optional className. Dashboard has its own inline copy — deliberately not migrated to avoid touching a working page. |
| `frontend/src/components/site-header.tsx` | Session 7 base + Session 11 edits: logo wrapped in `<Link href="/">`, `<MainNav />` rendered between logo and right-side controls. |
| `src/mcp/client.ts` | Session 13 — Added retry with exponential backoff (3 attempts, 2s/4s/8s) + full reconnect (tear down child process, spawn fresh) on persistent failure. Covers TradingView restarts, CDP drops, transient crashes. |
| `src/hyperliquid/orders.ts` | Session 13 — Switched from cross to isolated margin (`isCross: false`). Added `setTakeProfit()` (native trigger `tpsl: "tp"`), `setScaledTakeProfits()` (multiple TP levels with partial closes), `TakeProfitTarget` interface. |
| `src/db/trades.ts` | Session 13 — Added `source` field (`"bot"` \| `"manual"`, default `"bot"`). `TradeSource` type exported. |
| `src/scripts/test_custom_trade.ts` | Session 13 — CLI manual trade script: `<direction> <leverage> <sl%> <tp_levels> <notional>`. Supports scaled TPs (PowerShell: quote `"1,1.5,2"`). Pre-checks $10 min per TP slice. Monitors every 10s, detects partial TP fills, auto-closes on 30min timeout or Ctrl+C. Logs to Supabase with `source: "manual"`. |
| `frontend/src/app/(app)/trades/page.tsx` | Session 13 — Split into Bot Trades + Manual Trades sections with independent stats badges. Added leverage column. Extracted reusable `TradeTable` component. |
| `src/strategy/confluence.ts` | Session 14 — Added `getLeverageForSignals(signals)`: S1=10x, S2=8x, S3=5x fixed per-strategy. Overrides confluence scorer's leverage output. |
| `src/main.ts` | Session 14 — Removed week-1 LIVE clamp block. Uses `getLeverageForSignals` + `calcMarginBasedSize`. S3 entries place scaled TPs via `setScaledTakeProfits`. |
| `src/risk/manager.ts` | Session 14 — `MAX_OPEN_POSITIONS` restored to 3 (was 1 during week-1 cap). |
| `src/commands/handlers.ts` | Session 15 — Added `handleManualTrade`: validates payload, checks killed state + existing position, fetches mark price, places market order, waits 3s, sets SL + up to 3 scaled TPs. Returns full result (entryPrice, oids, tpCount). |
| `src/db/commands.ts` | Session 15 — `manual_trade: handleManualTrade` wired into HANDLERS dispatcher. |
| `frontend/src/app/actions/commands.ts` | Session 15 — Added `"manual_trade"` to `CommandType`, `result` field on `CommandActionResult` (read from `bot_commands.result` column after poll), `issueManualTrade()` wrapper. |
| `frontend/src/components/manual-trade-card.tsx` | Session 15 — New Client Component. 2-col layout: Long/Short toggle, leverage, USD size, SL price on left; 1–3 TP levels (auto-split 100% / 50+50 / 50+25+25) + submit on right. Confirmation dialog before submit. Shows BTC ref price from latest market snapshot. |
| `frontend/src/app/(app)/page.tsx` | Session 15 — `ManualTradeCard` added between main grid and bot logs. Passes `markPrice` from latest market snapshot. |

## Test Scripts

| Script | Purpose | Last status |
|--------|---------|-------------|
| `src/scripts/test_connection.ts` | Hyperliquid read-only smoke test | ✅ PASS 2026-04-11 — $499.77 withdrawable (Session 9 pre-flight) |
| `src/scripts/discover_tradingview.ts` | One-shot MCP API discovery (raw JSON dump) | ✅ DONE 2026-04-10 — reader written from this output |
| `src/scripts/test_dry_run.ts` | Full pipeline one-shot (no orders) | ✅ PASS 2026-04-10 — all 4 TFs clean, no signals |
| `src/scripts/test_micro_trade.ts` | $20 market entry + 30s hold + close. Direction CLI arg (Session 9): `long` (default) or `short` | ✅ PASS 2026-04-10 long ($0.0162), ✅ PASS 2026-04-11 short ($0.0183) |
| `src/scripts/test_stop_loss.ts` | $20 entry + stop-loss + verify on book + cancel + close. Direction CLI arg (Session 9): `long` (default, stop below entry) or `short` (stop above entry) | ✅ PASS 2026-04-10 long ($0.0155), ✅ PASS 2026-04-11 short ($0.0189) |
| `src/scripts/test_limit_order.ts` | Session 9 — places unfillable GTC limit 5% away from mark, both directions, verifies each on book via `openOrders`, cancels, final sweep | ✅ PASS 2026-04-11 — delta exactly $0.0000, both directions |
| `src/scripts/test_stop_cleanup.ts` | Session 9 — validates `closePosition`'s auto-cleanup of resting reduce-only stops. Opens $20 long + stop + closePosition + asserts 0 BTC orders remain | ✅ PASS 2026-04-11 — net cost $0.0173. **Note:** `cancelOpenBtcStops` found 0 stops during the test — Hyperliquid's native behavior already removed the reduce-only trigger when the position closed. Our helper is now a defensive safety net. |
| `src/scripts/test_risk_hydration.ts` | Session 11 — validates risk state hydration end-to-end. Part A: insert synthetic `risk_snapshots` row → `loadLatestRiskState()` → `hydrateState()` → assert 10 fields → delete synthetic row. Parts B-E: unit tests on `hydrateState()` for cross-day reset, expired pausedUntil clamp, future pausedUntil preserve, killed state preserve | ✅ PASS 2026-04-11 — 5/5 cases, zero pollution in `risk_snapshots` (test row cleaned up in finally block) |
| `src/scripts/test_custom_trade.ts` | Session 13 — CLI manual trade with SL + scaled TPs. Args: `<direction> <leverage> <sl%> <tp_levels> <notional>`. Logs to Supabase with `source: "manual"`. | ✅ PASS 2026-04-13 — entry/SL/TP placement confirmed on Hyperliquid. Scaled TPs (3 levels) confirmed on Open Orders. Kill switch close validated. PowerShell gotcha: quote `"1,1.5,2"` or commas are parsed as array separators. |

## What Was Done (Session 1) — Drift→Hyperliquid pivot + full bot wiring

1. **TradingView setup** — Installed TV Desktop, launched with `--remote-debugging-port=9222` via `launch_tradingview.ps1`, added 9 indicators on BINANCE:BTCUSDC (EMA 8/13/21/55/200, RSI 14, Stoch RSI, BBWP, PMARP).
2. **tradingview-mcp integration** — Cloned `tradesdontlie/tradingview-mcp`, configured in Claude Desktop's MCP config, verified `tv_health_check` returns connected state.
3. **Drift → Hyperliquid pivot** — Drift Protocol was hacked for $285M on 2026-04-01. Pivoted execution venue to Hyperliquid. Deleted `src/drift/`, created `src/hyperliquid/`, updated `package.json` (removed `@drift-labs/sdk`, `@solana/web3.js`, `@coral-xyz/anchor`; added `@nktkas/hyperliquid`, `viem`). Updated `.env.example` and `BTC_TRADING_STRATEGY_KB.md` Drift references.
4. **Hyperliquid account onboarding** — Created API wallet (agent) at app.hyperliquid.xyz with trade-only permissions. Deposited $500 USDC via Arbitrum bridge. Transferred USDC from Spot → Perps account (required for `clearinghouseState.withdrawable` to show balance).
5. **Hyperliquid execution module** — Implemented `client.ts` (viem wallet, dynamic BTC asset index lookup), `account.ts` (`getBalance`, `getOpenPositions`, `getFundingRate`), `orders.ts` (market orders as IOC limit at ±5% slippage cap, GTC limit, native trigger stop-loss with `tpsl: "sl"`, cancel order). Price/size rounding per Hyperliquid's precision rules.
6. **MCP SDK wiring** — Installed `@modelcontextprotocol/sdk`. Built `src/mcp/client.ts` that spawns tradingview-mcp as a child process and exposes `callTool()`.
7. **TradingView reader rewrite** — After running `discover_tradingview.ts` to see raw `data_get_study_values` response shape, rewrote `src/tradingview/reader.ts` to parse comma/percent strings, map 5 EMAs by chart order, and sequentially switch timeframes (1D → 4H → 1H → 15m).
8. **main.ts updates** — Replaced MCP stub with real `TradingViewMCP`, added `DRY_RUN` env var that skips order placement but runs full strategy evaluation.
9. **Live validation** — Ran 5 test scripts in order: connection (read-only), dry-run (no orders), micro-trade (long market $20), stop-loss (stop + cancel + close). All passed. Total cost to validate entire execution layer: ~$0.05 in fees.
10. **DRY_RUN loop started** — Bot started in a separate PowerShell window, running `main.ts` with `DRY_RUN=true` for extended validation across multiple ticks.
11. **TradingBot-specific skills installed** — Created `~/.claude/skills/wrap`, `start`, `save`, `doc-update` adapted for TradingBot's single-project structure.

## What Was Done (Session 2) — Frontend analysis + Supabase MCP + safety infrastructure

> **No `src/` changes this session.** DRY_RUN loop from Session 1 still running untouched.

1. **Frontend analysis** — Produced `FRONTEND_ANALYSIS.md` covering 5 pages (Dashboard, Trades, Strategies, Automation, Backtests/Journal), Supabase schema, command-bus pattern (bot subscribes to `commands` table, no tunnel needed), Next.js 15 App Router + shadcn/ui + Tailwind stack, single-user scope, config-only strategy editing, 4 extras (alerts, live logs, kill switch, backtests+journal).
2. **skillscanner installed** — Project-local security auditor at `.claude/commands/skillscanner.md`. Use `/skillscanner <path>` to vet any future skill before install. Analysis doc moved to `.claude/skill-analyses/` to prevent it being registered as a skill itself.
3. **Safety hooks installed** — 5 bash scripts in `.claude/hooks/`: `block-dangerous.sh` (rm -rf, curl | bash, force-push main), `block-internal-urls.sh` (SSRF protection), `protect-files.sh` (blocks `.env*`, `*.key`, `id_rsa`, etc. from Write/Edit), `scan-injection.sh` (50+ prompt-injection signatures in tool output), `audit-all.sh` (JSONL log at `~/.claude/safety-audit.jsonl`). Wired via `.claude/settings.local.json`. **Currently inert — `jq` is not on PATH.** Install jq via `winget install jqlang.jq` and restart VS Code to activate.
4. **frontend-design skill installed (global)** — Anthropic's official design skill at `~/.claude/skills/frontend-design/SKILL.md`. Scanned SAFE via skillscanner protocol. Guides Claude toward bold aesthetic commitments, away from generic AI slop.
5. **ui-ux-pro-max plugin installed** — Via `/plugin install ui-ux-pro-max@ui-ux-pro-max-skill`. Bundles `design`, `design-system`, `ui-styling`, `banner-design`, `brand`, `ai-multimodal` etc. Triggered by UI-related keywords.
6. **.gitignore updated** — Added `.env.local`, `.env.*.local`, Next.js patterns, `data/*.db*`, `emergency-snapshot.md`, `.claude/safety-audit.jsonl`. Prepares for git init when frontend is added.
7. **Supabase project created** — `gseztkzguxasfwqnztuo` (free tier, main/production). User added `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to `.env` and `NEXT_PUBLIC_SUPABASE_*` to `frontend/.env.local`.
8. **Supabase MCP configured** — `.mcp.json` with HTTP/OAuth URL `https://mcp.supabase.com/mcp?project_ref=gseztkzguxasfwqnztuo`. No service role key in config — auth via browser OAuth. TradingBot project entries added to `C:\Users\cryptomeda\.claude.json` (both backslash and forward-slash variants) with `enabledMcpjsonServers: ["supabase"]` pre-approved. Backup at `.claude.json.bak`. **MCP not yet live in this session** — requires a fresh chat session to initialize.
9. **Security finding flagged** — `C:\Users\cryptomeda\.claude.json` has a legacy Supabase PAT `sbp_...` stored in plaintext under the AuthVault project's `mcpServers` block (lines 275-288). Recommend rotating + migrating AuthVault to HTTP/OAuth format at some point. Not urgent.

## What Was Done (Session 3) — Supabase MCP fix + DRY_RUN long-loop validation

> **No `src/` changes this session.** DRY_RUN loop from Session 1 still running untouched — now has 12+ clean ticks.

1. **DRY_RUN long-loop validated** — User shared PowerShell output from the Session 1 DRY_RUN bot: 12 consecutive ticks at perfect 15-min cadence (17:09 → 19:39 UTC, ~2.5h), zero crashes, MCP connection stable across all ticks, Hyperliquid balance stable at $499.77, "No signals this tick" every tick (expected — strict confluence + no strong trend). **This retires the "main.ts long-running loop" untested code path.** Observability gap noted: ticks don't dump indicator values, so we can't tell *why* there's no signal without a future logging change.
2. **Supabase MCP path-normalization bug diagnosed** — In a fresh chat session, the Supabase MCP did not initialize and no OAuth browser prompt fired. Root cause: `~/.claude.json` contained **two TradingBot project entries** with different path casing — the backslash variant (`c:\\Users\\...\\TradingBot`) had `enabledMcpjsonServers: ["supabase"]` set, but the forward-slash variant (`c:/Users/.../TradingBot`) did not. Claude Code normalizes paths to forward slashes at runtime, so it was reading the second entry and ignoring the enabled servers list from the first.
3. **Fix applied to `~/.claude.json`** — Added `enabledMcpjsonServers: ["supabase"]` and `disabledMcpjsonServers: []` to the forward-slash TradingBot entry (line 319). AuthVault (line 275) left fully intact — still uses old stdio/PAT format for `supabase` + `context7`, user explicitly asked to keep it working. Fix will take effect on next fresh chat session (MCP servers register only at chat start, not mid-session).
4. **Wrap/handoff update** — This section + updated "What To Do Next" + updated "Untested Code Paths" + updated "Background Processes".

## What Was Done (Session 4) — Supabase MCP path-normalization fix (for real this time)

> **No `src/` changes this session.** DRY_RUN loop from Session 1 still running. Only `~/.claude.json` was edited.

1. **Supabase MCP verified not working** — In a fresh chat session after Session 3, no `mcp__supabase__*` tools registered. `ToolSearch` returned no matches.
2. **Session 3's fix was NOT persistent** — Inspecting `~/.claude.json` line-by-line revealed the forward-slash TradingBot entry (line 319) was missing `enabledMcpjsonServers: ["supabase"]`. The backslash variant (line 306) had it, but Claude Code normalizes paths to forward slashes at runtime and reads the wrong entry. Unclear whether Session 3 never actually saved the edit or whether another Claude Code config write overwrote it between sessions.
3. **Fix actually applied** — Added `enabledMcpjsonServers: ["supabase"]` + `disabledMcpjsonServers: []` to the forward-slash entry at line 319. Backup created at `~/.claude.json.bak-session4-20260410-220543`. JSON validated via `node -e "JSON.parse(...)"`. Backslash variant (line 306) untouched; AuthVault entry (line 275) untouched.
4. **Handoff updated** — this section.

**Important caveat:** Since Session 3 also claimed this fix and it vanished, there's a non-zero chance Claude Code rewrites `~/.claude.json` on session exit and strips custom keys. If Session 5 opens and the key is missing again, investigate Claude Code's config-write behavior before re-applying. Possible workarounds: (a) put the MCP server directly in the `mcpServers` block of the forward-slash project entry, (b) use a global-scope MCP config outside per-project state, (c) find whatever is normalizing the file and configure it to preserve unknown keys.

## What Was Done (Session 5) — Supabase MCP workaround (a): inline mcpServers

> **No `src/` changes this session.** DRY_RUN loop from Session 1 presumed still running — not verified this session. Only `~/.claude.json` was edited.

1. **Session 4's fix verified non-persistent (again).** Fresh chat session opened, no `mcp__supabase__*` tools registered, `ToolSearch` returned nothing. Inspected `~/.claude.json` — the forward-slash TradingBot entry's `enabledMcpjsonServers: ["supabase"]` from Session 4 was **gone**. This is now the third session in a row (3 → 4 → 5) where this opt-in list has silently vanished between sessions.
2. **Moved to workaround (a).** Instead of relying on `enabledMcpjsonServers` + `.mcp.json`, inlined the Supabase HTTP/OAuth server directly under `mcpServers` in the forward-slash TradingBot entry at line 319:
   ```json
   "mcpServers": {
     "supabase": {
       "type": "http",
       "url": "https://mcp.supabase.com/mcp?project_ref=gseztkzguxasfwqnztuo"
     }
   }
   ```
   Also re-added `enabledMcpjsonServers: ["supabase"]` + `disabledMcpjsonServers: []` as belt-and-suspenders (cheap redundancy). Rationale: `mcpServers` is a first-class, schema-known registry key that Claude Code itself writes to (e.g., the AuthVault entry at line 275 has inline Supabase+context7 in `mcpServers` and has persisted for months). If the config-stripping behavior is specifically targeting unknown/opt-in keys, `mcpServers` should survive.
3. **Backup + validation.** Backup at `~/.claude.json.bak-session5-20260410-221312`. JSON validated via `node -e "JSON.parse(...)"` using `os.homedir()` (literal `/c/Users/...` paths get mangled by Git Bash path conversion on Windows — noted for future sessions). Backslash variant (line 306) and AuthVault entry (line 275) untouched.
4. **Memory updated.** Updated `~/.claude/projects/c--Users-cryptomeda-Desktop-Swarm-myprojects-TradingBot/memory/claude_json_mcp_quirk.md` with the full Session 3/4/5 history, hypotheses for root cause, Session 5 workaround details, escalation path (workaround b if a fails), and the Git Bash path-mangling gotcha.
5. **Escalation plan (workaround b) if Session 6 opens with `mcpServers.supabase` stripped:** move the config to a project-independent scope — options are `~/.claude/settings.json`, a user-scope MCP config, or a Claude Desktop-style per-user MCP registry. Do NOT go in circles re-applying workaround (a) if it gets stripped too — that's our signal the rewriter is aggressive about the entire project subtree and we need to exit project state entirely.

**Caveats:**
- Fix only takes effect in a **fresh chat session** — MCP servers register at chat startup, not mid-session. Session 5 cannot verify its own fix.
- First `mcp__supabase__*` tool call in the new session should fire a browser OAuth prompt for `https://mcp.supabase.com/mcp?project_ref=gseztkzguxasfwqnztuo`. Approve it — no PAT needed.

## What Was Done (Session 6) — Supabase MCP unblocked, Phase 1 schema + full bot write layer

> **Major session.** `src/main.ts` and 5 new `src/db/*` files changed. DRY_RUN bot restarted twice (once for market/risk MVP, once for positions/trades/logs follow-up). All Supabase MCP tools now live. Bot now writes 5 of 11 Supabase tables every tick.

### 1. Supabase MCP saga — RESOLVED

1. **Session 5 workaround (a) verified persistent.** Fresh session opened, checked `~/.claude.json` via node script — the forward-slash TradingBot entry still had `mcpServers.supabase` inlined (Session 5 added it at line 319). `enabledMcpjsonServers: ["supabase"]` was stripped again (as predicted by the quirk) but the inline `mcpServers` block held. `claude mcp list` confirmed the server was registered, just "Needs authentication".
2. **OAuth flow — attempt #1 failed silently.** User clicked `/mcp` → "Needs Auth" on supabase → browser opened to `supabase.com/dashboard/authorize?...`. Chrome showed `ERR_SSL_PROTOCOL_ERROR "supabase.com sent an invalid response"`. Diagnosed via curl: `CRYPT_E_NO_REVOCATION_CHECK` (Windows Schannel couldn't reach OCSP endpoints). Root cause: **user had VPN active** which was intercepting TLS and blocking cert revocation checks. DNS was clean (Cloudflare/Google/ISP all agreed), Supabase servers were healthy, only the client-side TLS path was broken.
3. **User disabled VPN — attempt #2 succeeded visually but not functionally.** Browser rendered the authorize page correctly. User clicked Approve. But checking `.credentials.json` mtime showed it had NOT been rewritten. Diagnosis: the `/mcp` command spins up a short-lived listener on `localhost:<port>`, and the delay from VPN debugging + Chrome error + browser switching caused the listener to time out before the redirect reached it. The `auth_id=bcaf7d57-...` URL was also likely expired by then.
4. **Attempt #3 worked.** User re-triggered `/mcp` → "Needs Auth" → fresh `localhost:49136` listener → no delays this time → browser showed "Authentication Successful. You can close this window." `.credentials.json` updated. 20 `mcp__supabase__*` tools appeared in `ToolSearch`.

### 2. Task #3 — Phase 1 Supabase schema migrated

6 migrations applied via `mcp__supabase__apply_migration`:

| # | Migration | Contents |
|---|---|---|
| 001 | `core_tables` | `strategy_templates`, `strategy_configs` (+ `updated_at` trigger), `market_snapshots`, `positions`, `trades`, `risk_snapshots` + indexes |
| 002 | `command_bus_and_logs` | `bot_commands`, `bot_logs` + check constraints on `status`/`level` |
| 003 | `extras` | `journal_entries` (cascade on trade delete), `alert_configs`, `backtest_runs` |
| 004 | `rls` | Enable RLS on all 11 tables + single-user CRUD policies for authenticated role |
| 005 | `seed_strategy_templates` | S1/S2/S3 rows with full `param_schema` jsonb pulled from `src/strategy/s1_ema_trend.ts`, `s2_mean_reversion.ts`, `s3_stoch_rsi.ts` — no drift from TS source |
| 006 | `fix_trigger_search_path` | `alter function public.set_updated_at() set search_path = pg_catalog, pg_temp` — fixes the one real security advisor warning |

**Security advisors after migrations:** 15 remaining warnings, **all expected** `rls_policy_always_true` on INSERT/UPDATE/DELETE policies for 5 user-controlled tables (`alert_configs`, `backtest_runs`, `bot_commands`, `journal_entries`, `strategy_configs`). By design for single-user app. **Must be tightened** if we ever open Supabase Auth to external sign-ups or add a second user — gate on `auth.uid() = <your_user_id>` or `auth.jwt() ->> 'email' = '<your_email>'`.

### 3. Task #4 MVP — bot writes market_snapshots + risk_snapshots

Created `src/db/supabase.ts` (lazy singleton client) and `src/db/snapshots.ts` (`writeMarketSnapshot`, `writeRiskSnapshot`). Wired both into `runLoop()` in `src/main.ts`:

- **Restructured `runLoop`:** `scoreSignals()` is now called unconditionally (it handles empty signals by returning zeros). Moved above the "no signals" early return so snapshots are written BEFORE any return path. Result: every tick produces exactly 1 row in each of `market_snapshots` and `risk_snapshots`, regardless of whether a trade fires.
- **Added `getFundingRate()` fetch** — wrapped in try/catch, non-fatal. Populates `market_snapshots.funding_rate`.
- **Macro filter label** computed inline in `snapshots.ts` to match the enum constraint (`'bullish'|'bearish'|'neutral'`).
- **Graceful degradation** throughout — if `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are missing, `getSupabase()` returns null once and all writes become no-ops. Bot keeps running normally.
- **First tick after restart (21:14:09 UTC)** — both rows landed cleanly, verified via MCP query. Macro filter correctly identified as `bearish` (price $73,068 vs Daily EMA200 $83,640).

### 4. Task #4 follow-up — positions + trades + bot_logs writes

Created 3 more `src/db/*` files:

**`src/db/positions.ts`** — `syncPositions(hlPositions, marks)`:
- Upsert by synthetic key `${coin}_${direction}` (e.g. `BTC_long`), leveraging Hyperliquid's one-long-one-short-per-coin constraint
- Delete rows whose key is NOT in the current set (→ closed positions disappear from live table)
- Flat account fallback: delete all rows
- Wired into `runLoop` step 2b (right after balance sync)
- **Only the empty-set path has been exercised** (DRY_RUN account is flat)

**`src/db/trades.ts`** — `insertClosedTrade(...)`:
- Writes one row per closed trade with `pnl_usd`, `pnl_r` (computed from `riskDollar`), `entry_conditions` jsonb containing strategy/leverage/confluence_score/stop_distance_pct
- `strategy_config_id` null for now (until frontend creates variants)
- Called from `checkExits` after `recordTradeResult`
- **Never exercised** — DRY_RUN hasn't closed any trades

**`src/db/logs.ts`** — `initLogSink()`:
- Monkey-patches `console.log/warn/error` at main() startup. Originals captured once and stashed so recursion is impossible.
- Ring buffer of size 200, flushes to `bot_logs` every 2 seconds via `setInterval` (unref'd so it doesn't block exit)
- Source detection: regex matches `^\[([A-Za-z][\w-]*)\]` in first arg, lowercases to produce `bot`/`tradingview`/`mcp`/`hyperliquid`/`supabase`. Default `main`.
- Shutdown flush on `SIGINT`/`SIGTERM`/`beforeExit`
- Buffer overflow drops oldest + increments `droppedCount` (exposed via `getDroppedCount()`)
- Rationale for monkey-patch vs refactor: avoids churning ~30 `console.*` call sites across the codebase, but is "magical" — if something breaks, remove the `initLogSink()` call in `main()` to disable.

**`ActivePosition` interface extended** with 4 new fields (`riskDollar`, `leverage`, `confluenceScore`, `stopDistancePct`) so `insertClosedTrade` has everything it needs at close time.

**Second restart + verification tick at 21:26:29 UTC.** All 5 tables writing cleanly:
- `market_snapshots`: 2 rows (tick 1 + tick 2)
- `risk_snapshots`: 2 rows
- `bot_logs`: 24 rows, captured via monkey-patched console with correct source tagging
- `positions`: 0 rows (account flat, delete-all path ran successfully)
- `trades`: 0 rows (DRY_RUN)
- Zero error/warn lines in `bot_logs` → every write succeeded

### 5. Task #7 retired

"Add indicator-value logging to DRY_RUN tick output" — superseded by `market_snapshots.timeframes` jsonb which stores the full 4-TF snapshot (close + 5 EMAs + RSI + StochK/D + BBWP + PMARP per TF). Strictly better than stdout logging — queryable, historical, and available to the future frontend for free.

### 6. Side findings

- **Safety hook `protect-files.sh` fires without `jq`.** Contrary to Session 2's claim that hooks are fully inert until `jq` is installed, the protect-files hook blocked my attempt to edit `.env.example` this session. So file-protection works today; the other hooks (audit-all, scan-injection, block-internal-urls, block-dangerous) may still need `jq`.
- **`.env.example` not updated this session.** Because the hook blocked it. User needs to manually add these lines to `.env.example` at some point:
  ```
  SUPABASE_URL=https://your-project-ref.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=eyJ...
  ```
  (They're already in real `.env` — this is just documentation.)
- **`claude mcp list` caches via `~/.claude/mcp-needs-auth-cache.json`.** During the OAuth debugging, the stale cache made it look like auth wasn't completing even when it was. Worth knowing if we hit OAuth issues again.
- **5 tables active of 11.** Remaining 6 (`strategy_configs`, `bot_commands`, `journal_entries`, `alert_configs`, `backtest_runs` + read-only view of `strategy_templates`) all wait for the Next.js frontend.

## What Was Done (Session 7) — Supabase key rotation + full Next.js 16 frontend scaffold

> **No `src/` changes this session.** Only `.env` value rotated (key migration) and `frontend/` built from scratch. DRY_RUN bot restarted once to pick up the new Supabase key.

### 1. Supabase key system migration (legacy JWT → new publishable/secret keys)

**Trigger:** The user opened `.env.example` and added `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to it — but pasted the **real** legacy `service_role` JWT value instead of a placeholder. This was caught immediately by Claude on next Read and flagged as a template-file-leak risk (`.env.example` is designed to be committed/shared).

**Fix flow:**
1. User sanitized `.env.example` by replacing the service role JWT with a placeholder (minor nit: `SUPABASE_URL` still contains the real project ref `gseztkzguxasfwqnztuo` — not sensitive, but template hygiene says swap to `your-project-ref.supabase.co`).
2. Rotated the key defensively because it had been Read into Claude's conversation context. Discovered that Supabase has **deprecated the "Reset service_role key" button** — the project had been migrated to the new dual-key system (Publishable + Secret keys, `sb_publishable_...` / `sb_secret_...` format, each independently revocable, drop-in replacement for anon/service_role).
3. **New rotation flow:** Created `radingbot2` secret key in dashboard → user copied the full `sb_secret_...` value → updated `.env` (`SUPABASE_SERVICE_ROLE_KEY=sb_secret_...`) → restarted the DRY_RUN bot in the cmd.exe admin window → verified via Supabase MCP that market/risk/logs rows landed with a timestamp AFTER the restart (latest tick `22:10:23 UTC`, row counts jumped 2→5).
4. After verification: deleted the auto-created `default` secret key, then clicked **"Disable JWT-based API keys"** on the Legacy tab — this fully revoked the old `service_role` JWT (the compromised one) AND the legacy `anon` JWT at the project level.

**Important consequence:** the legacy `anon` JWT that Session 2 wrote into `frontend/.env.local` is also dead. The frontend uses the new `sb_publishable_...` key instead (see section 5).

**Memory saved:** `memory/supabase_new_api_keys.md` — documents the current credential state so future sessions know we're on the new system and should never look for "Reset service_role key".

### 2. Next.js 16 scaffold (the surprise)

Ran `npx create-next-app@latest frontend --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack --skip-install`. Expected Next 15 based on training data — **got Next 16.2.3, React 19.2.4, Tailwind v4**.

The auto-generated `frontend/AGENTS.md` explicitly warned: *"This is NOT the Next.js you know. APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code."* Heeded this.

**Next 16 breaking changes read and applied (from local `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`):**

| Change | Impact |
|---|---|
| `middleware.ts` → `proxy.ts` | File renamed, function exported as `proxy` not `middleware`. Matcher config same. Runs in **nodejs runtime only** — edge not supported for proxy in v16. |
| `cookies()`, `headers()`, `params`, `searchParams` **fully async** | Synchronous access removed entirely (was deprecated in 15). Every Supabase server-client helper must `await cookies()`. |
| Turbopack default for `dev` + `build` | No `--turbopack` flag needed. `.next/dev` output dir for dev, `.next` for build. |
| Tailwind v4 | No `tailwind.config.js`! Theme lives in `@theme inline { }` block in `globals.css`. PostCSS plugin is `@tailwindcss/postcss`. |
| React 19.2 Canary | Server Actions + `useActionState` are the form pattern. |
| `revalidateTag` requires 2nd arg | Not used yet in our code. |
| Images stricter defaults | `minimumCacheTTL` 60s → 4h, `qualities` restricted, local IP blocked, `domains` deprecated in favour of `remotePatterns`. Not relevant for us yet. |

**Cleanup during scaffold:**
- `create-next-app` initialized a nested `.git` repo inside `frontend/` (will conflict when we eventually `git init` the parent project) — deleted it.
- Session 2 left an empty 0-byte `frontend/.env.local` behind — removed it so create-next-app could scaffold cleanly, then user recreated with real values later.

### 3. shadcn/ui init — `base-nova` style, Base UI primitives (not Radix)

Ran `npx shadcn@latest init --defaults --yes`. The modern shadcn CLI uses a **preset system** now (`--defaults` = `--template=next --preset=base-nova`). The `base-nova` style is shadcn's new flagship — importantly, **it uses `@base-ui/react` under the hood, not Radix**. This is a material API difference from the Radix-era shadcn components.

**Installed components:** button (auto), card, table, badge, dropdown-menu, sonner, skeleton, separator. Also pre-installed by shadcn init: `next-themes`, `lucide-react`, `sonner`, `tw-animate-css`, `class-variance-authority`, `tailwind-merge`.

**Base UI vs Radix gotcha (hit one during implementation):** Base UI's composition pattern uses a `render={<ReactElement />}` prop instead of Radix's `asChild` prop. Initial theme-toggle write used `asChild` → `tsc --noEmit` caught it → switched to `<DropdownMenuTrigger render={<Button variant="outline" size="icon" />}>...</DropdownMenuTrigger>`. **This applies to every shadcn `base-nova` component** — any future `asChild` muscle memory will fail the type check.

### 4. Theme provider (dark default)

`src/components/theme-provider.tsx` wraps `next-themes`'s `ThemeProvider` in a `"use client"` boundary. Root layout (`src/app/layout.tsx`) adds `suppressHydrationWarning` on `<html>` and defaults to `attribute="class" defaultTheme="dark" enableSystem`. Theme toggle is a shadcn dropdown in the header with Sun/Moon icons that cross-fade via Tailwind's `dark:` variant.

### 5. Supabase integration for Next 16

**Three clients, three contexts:**

1. **`src/lib/supabase/client.ts`** — `createBrowserClient` for Client Components. Reads `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the `sb_publishable_...` key from section 1).

2. **`src/lib/supabase/server.ts`** — Async `createClient()` for Server Components / Actions / Route Handlers. Key line is `const cookieStore = await cookies()` — Next 16 mandatory. The `setAll` handler is wrapped in try/catch because Server Components can't write cookies; the proxy handles the canonical session refresh.

3. **`src/lib/supabase/proxy.ts`** — `updateSession(request)` for use in the proxy. Creates a scoped client, calls `supabase.auth.getUser()` (**not** `getSession()` — the latter reads cookies without verifying the token against the auth server, so it's unsafe for authorization decisions per the Supabase docs), refreshes cookies on the outgoing `NextResponse`, and redirects unauthenticated users to `/login` (except for `/login` and `/auth/*` routes).

4. **`src/proxy.ts`** — Next 16 replacement for `middleware.ts`. Exports `proxy` function (not `middleware`). Matcher excludes `_next/static`, `_next/image`, favicons, and common image extensions.

**Env var convention used:** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (not `NEXT_PUBLIC_SUPABASE_ANON_KEY`) — clearer that this is the new key format, and the old name would be confusing now that anon JWTs are revoked.

### 6. Magic-link auth flow

**Files:**
- `src/app/login/page.tsx` — Login card UI (Server Component)
- `src/app/login/login-form.tsx` — Client Component using `useActionState` (React 19.2)
- `src/app/login/actions.ts` — Server Action `sendMagicLink` that calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: ${origin}/auth/callback } })`. Builds origin from the `host` + `x-forwarded-proto` headers.
- `src/app/auth/callback/route.ts` — GET handler that receives `?code=...` from Supabase's verify endpoint, calls `exchangeCodeForSession(code)`, and redirects to the `next` param (default `/`). On error, redirects back to `/login?error=...`.
- `src/app/auth/signout/route.ts` — POST handler that calls `signOut()` and redirects to `/login` with a 303 status.

**Supabase Dashboard config required (user did this):**
- Authentication → URL Configuration → Site URL: `http://localhost:3000`
- Authentication → URL Configuration → Redirect URLs: add `http://localhost:3000/auth/callback`

**Form state UX:** On successful send, the form flips to a "Magic link sent to `<email>`" confirmation card with a Mail icon. On error, inline destructive-color text. On pending, button shows a spinning Loader2.

### 7. Dashboard page (`src/app/page.tsx`)

`export const dynamic = "force-dynamic"` — always SSR on each request, no caching. Fetches in parallel via `Promise.all`:
- Latest 10 `market_snapshots` ordered by `taken_at` DESC
- Latest 1 `risk_snapshots`
- Latest 20 `bot_logs`
- All rows from `positions`

**Layout:**
- `<SiteHeader>` — sticky top nav with logo, user email (from `supabase.auth.getUser()`), theme toggle, sign-out button.
- 4 stat cards: **Bankroll** (+ day/week PnL with pnlClass coloring), **BTC Price** (+ macro filter badge + funding rate), **Confluence** (N/3 with strategies-aligned label), **Positions** (count + consecutive loss count).
- Conditional "Bot paused" banner if `latestRisk?.paused_until` is set.
- Recent Ticks table (last 10 market snapshots) with Time, Price, Macro badge, Confluence, Funding.
- Open Positions card (empty state = "Flat" / otherwise a list with side badge, entry price, unrealized PnL coloring).
- Bot Logs viewer (last 20 lines, monospace, color-coded level tags, `[source]` prefix).

**Helper functions in `src/lib/format.ts`:** `formatUsd`, `formatPrice`, `formatPercent`, `formatFundingRate` (multiplies by 100), `formatRelativeTime`, `formatTime`. All null/NaN-safe.

### 8. Verification

`npx tsc --noEmit` in `frontend/` — **zero errors** after the Base UI `asChild → render` fix.

User started `cd frontend && npm run dev`, navigated to `localhost:3000`, was redirected to `/login`, entered `mjerabek1@gmail.com`, got the magic link email, clicked it, landed on `/auth/callback?code=...`, exchanged for session, redirected to `/`. Dashboard rendered with live data:
- Bankroll: **$499.77**
- BTC Price: **$72,818.27**
- Macro: **Bearish** (price below Daily EMA200)
- Confluence: **0/3** (every tick since Session 6 restart)
- Positions: **0 / Flat**
- 8 ticks visible in Recent Ticks table, all bearish macro, all confluence 0
- 20 log lines visible including `[Bot] No signals this tick.` and `[Bot] Hyperliquid balance: $499.77`

Screenshot confirmed. Theme toggle works. Sign-out button exists but not exercised.

### 9. Things NOT done this session (deliberately)

- **Kill switch / command bus.** Frontend has no write path yet. Read-only dashboard.
- **Trades / Strategies / Automation / Backtests pages.** Only Dashboard built — other 4 pages from FRONTEND_ANALYSIS.md remain open.
- **Email allowlist.** Any email can sign up. Fine for single-user localhost, must tighten before deploy.
- **Error UI polish.** `/login?error=...` is produced by the callback but `/login` doesn't render it.
- **Git init.** Still not a git repo. Both parent project and `frontend/.git` (removed) are tracked via handoff.md only.
- **Short-direction order tests (tasks #3-#7 in Session 6).** Still outstanding. All LIVE blockers.

## What Was Done (Session 8) — Phase 2 command bus MVP: kill switch + resume

> **Major session.** 6 bot-side files touched (2 new, 4 modified), 3 frontend files touched (2 new, 1 modified), 1 Supabase migration. Command bus infrastructure complete for kill/resume; pause/strategy-edits/automation still open. DRY_RUN bot restarted twice. Bot at wrap is in normal DRY_RUN state (`killed=false`, verified via latest risk_snapshot).

### 1. Migration 007 — command bus realtime publication + killed columns

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.bot_commands;
ALTER TABLE public.risk_snapshots
  ADD COLUMN killed boolean NOT NULL DEFAULT false,
  ADD COLUMN kill_reason text;
```

**Critical gotcha we pre-empted:** `bot_commands` was NOT in the `supabase_realtime` publication by default (the migration 002 `CREATE TABLE` doesn't auto-add). Without this explicit `ALTER PUBLICATION`, Realtime subscriptions connect silently and receive zero events. Anyone debugging a future dead subscription should check `pg_publication_tables` first.

The new `killed`/`kill_reason` columns on `risk_snapshots` mirror how `paused_until`/`pause_reason` already work — the dashboard reads from the latest row and shows a banner if either is set. Defaulted to `false`/`null` so existing writes and existing rows keep working without backfill.

### 2. Kill switch ≠ pause — deliberate separation

I considered and rejected hijacking `pausedUntil` with an "infinite" value for the kill switch. Two distinct concepts:

| | Kill switch | Pause |
|---|---|---|
| Trigger | Explicit manual action from dashboard | Automatic from drawdown limits in `risk/manager.ts` |
| Duration | Unbounded — cleared only by explicit Resume | Time-bounded (4h / 24h / 48h) |
| Side effect | Closes all open HL positions immediately | Does not touch open positions |
| Blocks exits? | Yes — `checkExits` is gated on `!killed` | No — positions keep evaluating exits normally |

Added a dedicated `killed: boolean` + `killedReason: string | null` to `RiskState`. `setKilled(reason)` zeroes `openPositions`/`totalExposureUsd` as a side effect (because the handler just closed everything), so subsequent `canTrade` calls after a resume don't misreport stale exposure.

`canTrade()` checks `killed` as the **highest-priority gate**, above `pausedUntil`, so a killed bot rejects trades instantly regardless of drawdown state.

### 3. Claim-then-execute pattern in `src/db/commands.ts`

Every incoming command row goes through:

1. **Atomic claim:** `UPDATE bot_commands SET status='running', started_at=now() WHERE id=$1 AND status='pending' RETURNING id`. If rowcount is 0, someone already claimed it (startup sweep racing a Realtime INSERT, duplicate delivery, future second consumer) — skip silently.
2. **Dispatch** to the handler lookup table (`HANDLERS[row.type]`). Unknown types → write `status='failed', error='Unknown command type: ...'`.
3. **Write result back:** on success `status='done', result=<jsonb>, finished_at=now()`; on failure `status='failed', error=<text>, finished_at=now()`.

The handler lookup table pattern makes adding new commands trivial — just export a new handler from `src/commands/handlers.ts` and register it in the `HANDLERS` map.

### 4. Startup sweep

Before subscribing to Realtime, the bot sweeps `bot_commands` for any `status='pending'` rows that arrived while it was down. Processes them in `issued_at` order through the same claim-then-execute path. This guarantees no command is silently dropped on a restart.

**Untested:** only the empty-sweep path has run — see Untested Code Paths.

### 5. Kill switch handler — operates on HL state, not bot memory

`handleKillSwitch` intentionally calls `getOpenPositions()` against Hyperliquid rather than iterating the bot's in-memory `activePositions[]`. Rationale: after a bot restart the in-memory list is empty, but Hyperliquid may still hold positions. Reading from HL makes the kill switch robust across restarts. DRY_RUN mode skips the `closePosition` calls entirely.

After all closes, the handler:
1. Calls `ctx.clearActivePositions()` (provided by `main.ts` — avoids a circular dep on the `activePositions` array)
2. Calls `setKilled(reason)` to flip the state flag
3. Calls `writeRiskSnapshot({state: getState()})` **immediately** — NOT waiting for the next 15-min tick. This is the key for dashboard responsiveness: within ~300ms of the command arriving, the dashboard can read the new killed state from Supabase.
4. Returns a typed result containing `{reason, dryRun, closedPositions, killedAt}`.

Error handling: even on partial failure (some closes errored), the handler still flips the killed flag. Intent was clear, dashboard needs to reflect it, operator can inspect and retry manually.

### 6. Graceful shutdown in `src/main.ts`

Added `process.once("SIGINT"/SIGTERM")` handlers that `await stopCommandSubscription()` then `process.exit(0)`. Without this the Realtime WebSocket would linger across Ctrl-C restarts. Verified by watching `[Logs] SIGINT received, flushing log buffer...` + `[Logs] Supabase log sink flushed...` land cleanly on bot stop.

Also added a `killed` gate at the top of `runLoop()`:
- `checkExits` is skipped entirely when killed (the kill switch already closed everything; strategy exit logic must not re-engage).
- Market snapshots are still written every tick (so the dashboard stays fresh even while killed).
- The "no signals" early return comes AFTER the killed early return, so `[Bot] Killed — skipping entries (reason)` is logged clearly.
- Position sync with Hyperliquid (`syncPositions`) still runs while killed — this is intentional so the dashboard reflects the actual post-kill account state.

### 7. Frontend Server Action — the insert→revalidate race and its fix

**First attempt** (broken): `issueCommand` inserted the row, then called `revalidatePath('/')` immediately. Result: user had to click the button twice. The race:

```
click → insert row (10ms) → revalidate (reads OLD risk_snapshot) → bot processes (300ms later)
click → bot has now written NEW risk_snapshot → revalidate catches it
```

**Fix** applied in `frontend/src/app/actions/commands.ts`: after insert, the Server Action **polls `bot_commands.status`** every 150ms until terminal (`done`/`failed`), then revalidates. Timeout 15 seconds — generous enough for LIVE closes of multiple positions (each ~1-3s), short enough to surface bot-offline as an error. Since the handler writes the immediate risk_snapshot BEFORE returning `done`, the revalidation catches the new state on first render.

Measured latency (from Supabase timestamps): insert → claim = 16ms, claim → done = 319ms. User-perceived click-to-UI-flip: ~500ms.

**Bonus:** this pattern gives typed error handling for free — failed handlers return their error message to the toast, timeouts report "Bot did not respond within 15s — is it running?", and auth failures never make it past `getUser()`.

### 8. Dashboard integration

- New `<KillSwitchButton killed={...}>` in the header area of `frontend/src/app/page.tsx`. Destructive red "Kill Switch" button by default, flips to default green "Resume" when killed. Uses `window.confirm` for the kill confirmation (proper shadcn alert-dialog is a follow-up polish item).
- New KILLED banner ABOVE the existing paused banner — same `Card` structure, `destructive/10` background, `OctagonX` icon, reads `latestRisk.kill_reason`.
- Extended `RiskSnapshot` type to include `killed` + `kill_reason`.
- `useTransition` gives pending state → loader spinner on the button while the Server Action waits for the bot.
- Sonner toast on success/error (already wired in from Session 7's layout).

### 9. Verification completed this session

1. **Bot-side via MCP insert** — inserted `kill_switch` row via `mcp__supabase__execute_sql`, observed logs: Executing → KILL SWITCH activated → DRY_RUN — skipping → done. Measured 16ms claim latency, 336ms total. ✅
2. **Risk snapshot updates** — confirmed immediate `risk_snapshots` row with `killed=true` landed ~300ms after insert. ✅
3. **Resume via MCP** — same pattern in reverse. ✅
4. **Frontend end-to-end** — user clicked Kill Switch button, saw confirm dialog, confirmed, button spinner showed briefly, green toast appeared, red banner rendered, button flipped to Resume. Clicked Resume, banner cleared, button flipped back. Single click works. ✅
5. **Bot logs visible in dashboard** — `[Commands]` log lines all tagged `source='commands'` via the existing log sink prefix detection. ✅

### 10. Non-goals this session (deliberate)

- **Pause/Unpause commands.** Separate from kill switch — would add `handlePause(durationMs)` wrapping the existing `triggerPause` + `clearPause`. Trivially follow-up.
- **Proper shadcn alert-dialog for confirm.** `window.confirm` is janky but ships. Takes ~15 min to swap for a real dialog.
- **Realtime reconnect with backoff.** If the WebSocket drops, commands silently stop reaching the bot. Need to watch `CHANNEL_ERROR`/`TIMED_OUT` statuses and re-subscribe. Works fine today, but fragile.
- **Orphaned stop-loss cleanup on kill.** Kill switch closes positions via `closePosition` but leaves any resting reduce-only stop-loss orders on the HL book. Tracked as task #11.
- **Strategy param live-edits.** The big Phase 2 value-add that requires the Strategies page. Defer to the frontend push.
- **Command history viewer.** Would show the last N `bot_commands` rows on the dashboard. Low effort, low priority.

## What Was Done (Session 9) — Path A prep for LIVE: short-order validation + auto stop-cleanup + week-1 caps

> **Execution session.** 4 source files modified, 2 new test scripts, 5 real-money validation runs on mainnet. Total fee/slippage cost: **$0.0544** (from $499.7683 → $499.7139). Retired 4 LIVE blockers from "Untested Code Paths". LIVE flip (#10) deliberately deferred to Session 10 for fresh-eyes monitoring. Session 8's DRY_RUN bot is still running in its PowerShell window with OLD code — Session 10's first action MUST be Ctrl+C'ing it cleanly and restarting with Session 9's code.

### 1. Tasks #4, #5, #6 — short-direction + GTC limit validation

**Approach:** rather than duplicating the existing long-only test scripts, parameterized `test_micro_trade.ts` and `test_stop_loss.ts` to accept a `long|short` CLI arg (defaulting to `long` preserves existing invocation). For task #6, created a brand new `test_limit_order.ts` — no analog existed to parameterize.

**Task #4 — `test_micro_trade.ts short`** ($0.0183): $20 BTC short @ 1x via `placeMarketOrder("short", ...)` (IOC limit at mark × 0.95 cap), 30s hold, `closePosition("short")`. Clean fill-to-close, no surprises. This was the highest-risk "untested" item from Session 1 — symmetric to the long test, but the SDK's direction handling had never been exercised with real money on the short side.

**Task #5 — `test_stop_loss.ts short`** ($0.0189): $20 BTC short entry + stop-loss trigger @ entry × 1.05 (5% ABOVE entry, never triggers), verified on book via `openOrders` with `reduceOnly: true`, canceled, closed. This was the first-ever test of `setStopLoss("short", ...)` which uses `closeIsLong: true` (buy-stop) with `tpsl: "sl"`. The openOrders response confirmed `side: "B"` (buy) and `reduceOnly: true` — exactly as expected.

**Task #6 — `test_limit_order.ts`** ($0.0000): places unfillable GTC limit orders 5% away from mark (both directions, one at a time), verifies on book, cancels, verifies gone from book. Balance delta exactly $0.00 because nothing filled. First-ever exercise of `placeLimitOrder` in EITHER direction on mainnet — this is the S2 entry path. The script also has an explicit sanity check that aborts + cancels if a position unexpectedly opens (which would indicate the limit somehow filled).

### 2. Task #11 — stop-loss auto-cleanup in closePosition

**Problem:** orphaned reduce-only stops after `closePosition` would accumulate on the book. Before Session 9, the bot had no mechanism to cancel them — after N closes, you'd have N stale stops sitting on the book.

**Investigation findings:**
- `closePosition` has two callers: `checkExits` in `main.ts` (strategy-driven exit) and `handleKillSwitch` in `commands/handlers.ts` (manual kill). Both needed the fix.
- `ActivePosition` in `main.ts` stores `stopPrice` (numeric) but NOT `stopOid` — so we can't "cancel by remembered id". Had to go query-based instead.
- **Filter signal identified:** from the test_stop_loss.ts openOrders dump, stops have `reduceOnly: true`. Regular GTC entry limits (from task #6) have NO `reduceOnly` field at all. So the filter `coin === "BTC" && reduceOnly === true` cleanly isolates stop-losses without touching pending S2 entry limits.

**Implementation:** added `cancelOpenBtcStops(): Promise<number>` in `src/hyperliquid/orders.ts`. Filters `openOrders` by the signal above, batch-cancels via `ctx.exchange.cancel({ cancels: [...] })`, returns count, logs the canceled oids. Embedded in `closePosition` at two points:

1. **After successful close:** wrapped in try/catch — a cleanup failure must NOT throw and mask a successful close. If cleanup fails, the position is already flat and the orphaned stop is harmless (reduce-only on 0 position is a no-op).
2. **Empty-position early return:** even when `closePosition` finds nothing to close, it still scrubs stale stops — this catches orphans from crashed prior sessions.

**"Why after close, not before":** if we canceled stops first and then the close failed, we'd have a naked position with no stop. Close-first-then-cleanup leaves us in a safer state on cleanup failure.

**Verification:** new `test_stop_cleanup.ts` opens a $20 long, places a stop, verifies it's on the book, calls `closePosition("long")`, asserts 0 BTC orders remain. Result: ✅ pass. **But an interesting observation surfaced:** `cancelOpenBtcStops` ran and found 0 stops to cancel (no `[Orders] Canceled N orphaned...` log line appeared between `[Orders] Closed long` and the final verification). That means **Hyperliquid natively removes reduce-only trigger orders when the position closes** — either atomically with the close fill or within microseconds of it. Our helper's "canceled > 0" branch is now technically still untested in a real scenario.

**What this means for LIVE risk:** the kill switch (which closes positions via `closePosition` in a loop) inherits this auto-cleanup for free. Even if Hyperliquid's native behavior changes someday, our defensive code catches it. Risk from orphaned stops is effectively zero on this exchange.

**Handlers.ts doc comment updated:** removed the "intentionally out of scope" note about stop cleanup that Session 8 left behind.

### 3. Task #9 — week-1 LIVE risk caps

Per the plan: before first LIVE, tighten the bot's risk envelope for the first week while we learn whether the LIVE code path is safe under real capital. Three hard clamps:

1. **Max concurrent positions: 3 → 1** (in `src/risk/manager.ts`). Simple constant edit. Doc comment updated with a TEMP note + pointer to this task.
2. **Max leverage: 2x** (in `src/main.ts`). Clamps `confluence.leverage` down to 2 after `scoreSignals` returns. Logs `[Bot] Week-1 cap: clamping leverage Nx → 2x` when clamping fires.
3. **Max risk per trade: 1%** (in `src/main.ts`). Clamps `confluence.riskPercent` down to 0.01 after `scoreSignals`. Logs similarly.

The clamps are a mutable block in `main.ts` with a TEMP comment explicitly saying "Remove after the first LIVE week". Not env-driven — kept deliberately inline and visible so it's impossible to forget about. The KB values in `BTC_TRADING_STRATEGY_KB.md` were NOT touched — the KB remains the strategic source of truth, and these caps are operational scaffolding.

**Budget with Session 9 caps:** max risk per trade = 1% × $499.71 ≈ **$5.00**. Max notional ≈ $10-25 (depends on stop distance). Max of 1 concurrent position. Daily drawdown trip still at 10% = ~$50, weekly at 15% = ~$75.

**Typecheck:** `npx tsc --noEmit` clean after all Session 9 code changes.

### 4. Task #10 — LIVE flip deliberately deferred

The user chose to sleep on it and execute the flip in Session 10 with fresh attention, rather than rush the first LIVE transition at end-of-session. The full procedure is already scoped (see "What To Do Next" for Session 10's Stage 1/2/3/4 breakdown). Residual risk flagged: if `setStopLoss` fails after a successful `placeMarketOrder`/`placeLimitOrder` entry, the position is briefly naked — no retry logic exists yet. Mentioned but not fixed this session.

### 5. Non-goals this session (deliberate)

- **LIVE flip.** Deferred to Session 10.
- **Stop-placement retry on entry.** Known residual risk; would add ~10 lines + a test. Punt to post-LIVE if first week goes clean.
- **Supabase writes from the test scripts.** The validation tests don't touch Supabase — they only use the Hyperliquid SDK. The old DRY_RUN bot in its PowerShell window did however probably see the brief positions during its 15-min ticks and write them via `syncPositions` → this means task #7 (`syncPositions` upsert path) may have been incidentally exercised. Not verified — would need to grep `bot_logs` / `positions` table for Session 9's tick window.
- **Running the new code in DRY_RUN before LIVE flip.** Part of Session 10's Stage 2 — cheaper to do it then in one continuous sitting than to add a "restart for 1 tick" step now.

## What Was Done (Session 10) — LIVE flip executed

> **Execution + observation session.** The project's first LIVE bot run. No source files in `src/` changed — all work was running Session 9's already-typechecked code through the 4-stage DRY_RUN → LIVE transition, watching carefully, and retiring untested code paths via real-world observation. One frontend config edit (cosmetic). One operational bug discovered (TradingView Desktop + Windows sleep). Bankroll unchanged — no signal has fired yet under the new code.

### 1. TradingView-after-sleep recovery detour (pre-flip)

The user had put the laptop to sleep overnight, which silently broke the Session 8 DRY_RUN bot that was still running. On wake, every tick threw `Error: Expected 5 EMA studies, got 0` inside [src/tradingview/reader.ts:146](src/tradingview/reader.ts#L146) — the MCP's `data_get_study_values` was returning an empty array. The bot's per-tick `try/catch` in `runLoop` ([src/main.ts:103](src/main.ts#L103)) caught the error cleanly, so no crash, but the bot was effectively blind across two ticks + one manual restart.

**Root cause:** TradingView Desktop loses its chart/indicator state when Windows suspends the process. The MCP reconnects to TV fine on its own, but the TV window itself has no indicators loaded post-sleep. Confirmed by: same error across a fresh `npm start` (which spawned a new tradingview-mcp child), meaning it's not an MCP-side issue. Resolved by relaunching TV manually; bot ticks went back to clean.

**Wins from the detour:**

- **Log sink SIGINT flush validated** ✅ — when the user Ctrl+C'd the erroring bot, `[Logs] SIGINT received, flushing log buffer...` and `[Bot] Received SIGINT — shutting down` both appeared in the expected order. This was listed as "Log sink `SIGINT/SIGTERM` flush (Session 6)" in Untested Code Paths.
- **Per-tick error isolation validated** ✅ — the loop error didn't crash the process; `runLoop` caught it and the next 15-min tick fired as scheduled. Means a transient TV hiccup in LIVE won't take down the bot, just blind it for one tick.
- **Exposure-limit gate validated with a real signal** ✅ — during the pre-sleep ticks, at 00:39 UTC, an S3 long signal had actually fired: `Confluence: score=3, direction=long, leverage=3x; Sizing: $2498.57 notional, $832.86 margin, risk $9.99; Trade blocked: Exposure limit: adding $832.86 would exceed 60% of bankroll`. This was the first real exposure-gate rejection in project history. Under Session 9's new code, the same signal would have been clamped (leverage 3x→2x, risk 2%→1%) but would still be blocked — halving risk halves notional, and lowering leverage *raises* margin, so at 2x the margin would be $624.64 (still > $299.83 = 60% × $499.71). The clamp logging still hasn't fired because no signal landed after the flip to new code.

### 2. Stage 1 — clean stop of the old DRY_RUN bot

After fixing TV Desktop, the user Ctrl+C'd the old Session 8 bot. Flush sequence confirmed. Realtime subscription closed cleanly (`[Commands] Realtime subscription closed`). No orphan processes.

### 3. Stage 2 — new code in DRY_RUN for 1 tick (got 3 ticks — even better)

`$env:DRY_RUN="true"; npm start` in the same PS window. `ts-node` compiled from source, so the new process was unambiguously running Session 9's code. Banner confirmed `Mode: DRY RUN`. Ran 3 ticks (09:04, 09:20, 09:35 UTC) before the user Ctrl+C'd for the LIVE flip. All 3 ticks clean; balance held at $499.71; confluence 0/3 every tick.

**Wins from Stage 2:**

- **Realtime reconnect on CHANNEL_ERROR validated** ✅ — tick 09:20 showed:
  ```
  [Commands] Realtime subscription CHANNEL_ERROR
  [Commands] Realtime subscription active
  ```
  The subscription handler auto-recovered within the same tick without any intervention. This retires the "Realtime reconnect after WebSocket drop (Session 8)" untested path — the Supabase realtime-js client has built-in reconnect behavior that self-heals transient WS hiccups. The user's kill switch clicks will still land on the bot even if the WebSocket briefly dropped.

### 4. Stage 3 — LIVE flip

Ctrl+C'd Stage 2's DRY_RUN (clean flush). Then `$env:DRY_RUN="false"; npm start`. Banner critically verified: `[Bot] Mode: LIVE` (NOT DRY RUN). First LIVE tick at 2026-04-11 09:38:37 UTC. Clean connection to Hyperliquid mainnet. Balance read $499.71. `No signals this tick`.

As a deliberate validation, the user clicked the dashboard kill switch during this first LIVE tick:

```
[Commands] Executing kill_switch (id: 4e057af3…)
[Commands] KILL SWITCH activated — reason: Dashboard manual kill
[Commands] kill_switch done (id: 4e057af3…)
```

**Critical observation:** the `[Commands] DRY_RUN — skipping Hyperliquid close calls` line that appeared in every DRY_RUN kill switch test from Session 8 was **absent**. That confirms the LIVE code path actually entered the `closePosition` loop (which took the empty-`activePositions[]` branch and returned cleanly). This retires ~half of the "Kill switch close-all in LIVE mode (Session 8)" untested path. The still-untested half is the "kill switch with actual open LIVE position" branch — we'll let that happen naturally on first real trade.

**Frontend dashboard latency measured:** `POST / 200 in 2.7s └─ ƒ killSwitch("Dashboard manual kill") in 2015ms` — end-to-end click → Supabase insert → Realtime → bot pickup → claim → execute → write-back → response was ~2s. The server action's 15s timeout is nowhere near being hit.

### 5. Stage 4 — monitoring the first LIVE hour

7 clean LIVE ticks in total (09:38, 09:53, 10:08, 10:23, 10:38, 10:53, 11:08 UTC). Balance stable at $499.71 across all of them (no drift, no phantom fees, no mystery API behavior). No CHANNEL_ERROR events. No TradingView hiccups. Confluence 0/3 every tick.

During tick #2 (09:53 UTC), since the bot was still in killed state from the Stage 3 validation kill, we got another previously untested path:

```
[Bot] Killed — skipping entries (Dashboard manual kill).
```

**`isKilled()` runLoop gate validated** ✅ — that code path had never fired in a real tick before. Session 8's tests had toggled kill→resume too fast for a 15-min tick to land in the middle. Now we have: tick ran → saw killed state → correctly skipped entries → received resume → cleared → next tick (10:08) scanned normally.

### 6. `turbopack.root` fix for frontend/next.config.ts

The frontend dev server had been printing a "multiple lockfiles" warning because Turbopack walks up looking for a `package-lock.json` and was finding the bot's at `TradingBot/package-lock.json` before the frontend's at `TradingBot/frontend/package-lock.json`. Fix: set `turbopack.root` explicitly in [frontend/next.config.ts](frontend/next.config.ts) to `path.dirname(fileURLToPath(import.meta.url))`. Used `fileURLToPath` rather than `import.meta.dirname` for compatibility with any Node ≥20.9 (Next 16's minimum). Pattern follows the bundled doc at `frontend/node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopack.md`. Requires a frontend dev server restart to pick up — not required for the LIVE bot to keep running. NOT yet verified post-restart.

### 7. Summary of untested paths retired this session

| Path | Previously flagged | Retired via |
|------|--------------------|-------------|
| Log sink `SIGINT` flush | Session 6 | Ctrl+C during TV-sleep recovery detour |
| Exposure limit gate with real signal | implicit | Pre-sleep S3 long blocked ($832.86 > 60% × $499.71) |
| Realtime reconnect on CHANNEL_ERROR | Session 8 | DRY_RUN tick 09:20 auto-recovered in-tick |
| LIVE kill switch (empty-positions branch) | Session 8 | LIVE tick 1 — no `DRY_RUN skip` line |
| `isKilled()` runLoop tick gate | implicit | LIVE tick 2 — `Killed — skipping entries` fired |

### 8. New issue discovered

**TradingView Desktop loses chart/indicator state on Windows sleep.** Not a code bug — an environmental one. The MCP can't tell whether TV has indicators loaded or is just in a degenerate state. No code fix attempted. Mitigations for LIVE:

1. Keep laptop awake (Power settings → "Never" sleep on AC).
2. Or: relaunch `launch_tradingview.ps1` after any sleep/wake cycle before expecting the bot to produce valid snapshots.
3. Or: build a TV-state sanity check at bot startup (would go into [src/tradingview/reader.ts](src/tradingview/reader.ts)). Deferred — not worth the scope creep during LIVE validation week.

Residual risk in LIVE: if the laptop sleeps while a position is open, the bot goes blind and can't run `checkExits`. The exchange-side stop-loss order would still fire at the native level, but the bot's own trailing logic (if any) and risk-manager bookkeeping would be stale until the bot sees valid snapshots again. Accept the risk for now; this is a monitored first-week LIVE run.

### 9. Non-goals this session (deliberate)

- **Running test scripts.** None ran this session — test_micro/stop/limit/cleanup were all exercised in Session 9 and their results stand.
- **Code changes to src/.** Deliberately zero — the point of Session 10 was to validate Session 9's code, not add more.
- **Stop-placement retry on entry.** Still a known residual risk. Not fixed.
- **Supabase data verification for Session 9 side effects.** Still unverified whether the old DRY_RUN bot's `syncPositions` fired during Session 9's test windows. Low priority — will be exercised naturally on first LIVE trade.
- **Fixing the TV-after-sleep bug.** Operational mitigation only.

## What Was Done (Session 13) — MCP reconnect, isolated margin, take-profit + scaled TPs, manual trade tracking

> **Reliability + trading features session.** Bot source files changed: `src/mcp/client.ts`, `src/hyperliquid/orders.ts`, `src/db/trades.ts`. New file: `src/scripts/test_custom_trade.ts`. Frontend change: `trades/page.tsx`. Bot restarted once mid-session to pick up MCP reconnect code. Several manual test trades executed on mainnet (~$0.10 in fees).

1. **Vercel auth setup (#27 + #28)** — User added `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to Vercel dashboard. Updated Supabase Auth settings: Site URL → `https://trade-kit.vercel.app`, added `https://trade-kit.vercel.app/**` to Redirect URLs. Login tested end-to-end on production. Closes tasks #27 and #28.
2. **Sign-ups disabled (#18)** — User turned off "Allow new users to sign up" in Supabase Auth settings. Only the existing `contact@mdntech.org` account can log in. Closes task #18.
3. **TV sleep mitigation (#21)** — User changed Windows power settings to never sleep. Laptop runs 24/7. Mitigated (not architecturally solved). Task #21 downgraded to low priority.
4. **MCP reconnect (#12)** — `src/mcp/client.ts` now retries `callTool` up to 3 times with exponential backoff (2s → 4s → 8s). After all retries fail, tears down the child process and spawns a fresh `tradingview-mcp` instance + one final attempt. Covers TradingView restarts, CDP drops, and transient child-process crashes. Bot restarted mid-session to pick up the change; clean tick observed. Closes task #12.
5. **Isolated margin** — `ensureLeverage` in `src/hyperliquid/orders.ts` switched from `isCross: true` to `isCross: false`. Isolated margin limits max loss to allocated margin per trade, safer than cross where the entire balance is at risk. Applied to all future trades (bot and manual).
6. **Take-profit support** — Added `setTakeProfit()` to `src/hyperliquid/orders.ts`. Uses Hyperliquid's native trigger order with `tpsl: "tp"`. Mirrors the existing `setStopLoss` pattern.
7. **Scaled take-profits** — Added `setScaledTakeProfits()` to `src/hyperliquid/orders.ts`. Places multiple reduce-only TP triggers at different price levels, each closing a portion of the position (e.g., 50% at +1%, 25% at +1.5%, 25% at +2%). Handles rounding dust on the last target. Exported `TakeProfitTarget` interface.
8. **Manual trade test script** — New `src/scripts/test_custom_trade.ts`. CLI-driven: `npx ts-node src/scripts/test_custom_trade.ts <direction> <leverage> <sl%> <tp_levels> <notional>`. Supports single or scaled TPs (quote the comma-separated arg in PowerShell: `"1,1.5,2"`). Pre-checks minimum TP slice size ($10 Hyperliquid min). Monitors every 10s, detects partial TP fills, auto-closes on 30min timeout or Ctrl+C. Logs to Supabase `trades` table with `source: "manual"`.
9. **Manual trade tracking** — Added `source` column to `trades` table (`bot` | `manual`, default `bot`). Migration: `ALTER TABLE public.trades ADD COLUMN source text NOT NULL DEFAULT 'bot' CHECK (source IN ('bot', 'manual'))` — run manually by user in Supabase SQL Editor. `insertClosedTrade` in `src/db/trades.ts` accepts optional `source` param.
10. **Trades page split** — `frontend/src/app/(app)/trades/page.tsx` now shows two sections: **Bot Trades** (strategy-driven) and **Manual Trades** (from test script), each with its own stats badge (PnL + W/L). Combined stats cards at top. Added leverage column to trade tables. Extracted reusable `TradeTable` component.
11. **Pushed to GitHub + Vercel auto-deploy** — commit `65b6c7e`.

## What Was Done (Session 12) — GitHub/Vercel deployment + Market Data page + design overhaul

> **Frontend-focused session.** No bot source changes — the LIVE bot ran undisturbed the entire session. Re-flipped to LIVE mode at session start; hydration path validated on real restart. Pushed codebase to GitHub, deployed frontend to Vercel, and built a comprehensive Market Data page with design improvements across all pages.

### 1. GitHub + Vercel deployment
- Initialized git repo, pushed to `github.com/bugiiiii11/TradeKit` (10 commits by session end)
- Connected to Vercel — frontend auto-deploys on push to `trade-kit.vercel.app`
- Fixed: `frontend/` had its own `.git` (embedded repo) — removed, added as regular files
- Added `debug.log` to `.gitignore`

### 2. Auth: magic link → email/password
- Replaced `signInWithOtp` with `signInWithPassword` in login form
- Created user `contact@mdntech.org` via Supabase admin API (one-time script, deleted after use)
- Files: `frontend/src/app/login/actions.ts`, `login-form.tsx`, `page.tsx`

### 3. Market Data page (new)
- **Market Overview**: CoinGecko API for BTC, ETH, SOL, BNB prices with 1h/24h/7d changes (60s ISR cache)
- **Market Metrics**: Total market cap, BTC/ETH dominance, Fear & Greed index (alternative.me), BTC funding rate
- **BTC Technical Dashboard**: Macro filter, momentum (RSI/StochRSI), volatility (BBWP/PMARP), EMA alignment — all from existing `market_snapshots` in Supabase, with plain-English explanations
- No bot changes needed — prices from CoinGecko, technicals from existing bot data
- File: `frontend/src/app/(app)/market-data/page.tsx`

### 4. Mobile optimization
- Bottom tab bar with 5 icons (Home, Market, Trades, Strategy, Auto) — `frontend/src/components/mobile-nav.tsx`
- Bot logs: stacked layout on mobile instead of multi-column
- Automation table: hides Duration/Reason/Result columns on mobile
- Safe area padding for iPhone home indicator
- Viewport meta with `viewport-fit: cover`

### 5. Design overhaul (fintech color system)
- **Color system**: cyan-teal accent (hue 195), navy-slate dark backgrounds, cool gray light backgrounds
- **Theme toggle**: simplified to single-click light/dark (removed System option)
- **Card hover effects**: stat cards lift 2px with cyan glow border + shadow on hover (both themes)
- **Card borders**: visible at rest — white-ish on dark (18% opacity), dark on light (22% opacity)
- **Scroll animations**: `AnimateIn` component using IntersectionObserver — all 5 pages
- **Header**: gradient accent line, logo hover scale + cyan text, button hover effects (theme=cyan, signout=red)
- **Header fixed**: switched from `sticky` to `fixed top-0` for reliable always-on-top
- **Renamed**: "TradingBot" → "TradeKit" in header

### 6. LIVE mode re-flip
- User started bot with `$env:DRY_RUN="false"; npm start`
- Hydration validated: `[Bot] Hydrated risk state from 2026-04-11T21:28:13` — first real exercise of Session 11's hydration code
- `daily_start_bankroll` column writes now active (running Session 11 code)
- 20+ clean LIVE ticks observed, balance stable at $499.71, 0 signals (bearish macro)

## What Was Done (Session 11) — Frontend app buildout + risk state persistence + Next 16 config war

> **Mixed build + incident session.** Shipped 3 new frontend pages and a proper risk-state hydration system (task #13, long-outstanding). Hit a brutal Next 16 config ESM/CJS interop bug that OOM-crashloop'd the laptop and took out the LIVE bot as collateral damage. Bot recovered cleanly (0 positions the whole time) but was restarted in DRY_RUN to build infrastructure under safer conditions.

### 1. Frontend — (app) route group + Trades / Strategies / Automation pages

Refactored `frontend/src/app/page.tsx` into a shared-layout `(app)` route group and added three new pages, all passing `npx next build` clean. Closes tasks #17 (mostly) and #19.

**New layout pattern:** `frontend/src/app/(app)/layout.tsx` renders `<SiteHeader />` + `<main>` wrapper; individual pages just return their content. Dashboard, Trades, Strategies, and Automation all share this.

**`main-nav.tsx`** (Client Component) — tab-style nav with active-state highlight via `usePathname`. Hidden below `md` breakpoint — mobile hamburger deferred.

**`(app)/automation/page.tsx`** — Reads latest 100 `bot_commands` rows. 4 stat cards (Total / Succeeded / Failed / Last 24h) + history table. Immediately surfaced real data on first load: 10 rows from Sessions 8 + 10's kill_switch + resume commands, all showing correct badges, durations (141ms → 1.07s), reasons, and results (e.g. "Closed 0 positions (dry-run)"). The "failed" stat card is destructive-toned if any row is failed, default-toned if 0 — zero today, so green across the board.

**`(app)/trades/page.tsx`** — Reads latest 100 `trades` rows. 4 stat cards (Total PnL tone-colored, Win Rate, Avg R, Best/Worst) + trade history table. Currently shows the rich empty state ("No trades yet — the bot hasn't closed a trade yet. On the first LIVE close…") because `trades` is still empty at wrap. This is deliberately front-and-center so it doesn't look broken when a trade finally fires.

**`(app)/strategies/page.tsx`** — Reads `strategy_templates` + `strategy_configs` + `trades` in parallel and joins trades to templates via `strategy_configs.template_id`. Per-template card: icon + name + template ID badge + description + live stats (Trades/Win Rate/PnL) + top 6 Key Parameters from `param_schema.groups` (priority: risk → timeframes → entry → exit). Currently renders `0 configs · 0 enabled` across all three since no configs have been created — the page is ready for when the UI grows a config editor.

**`(app)/page.tsx`** (Dashboard) — Moved from `src/app/page.tsx`, stripped of its own `<SiteHeader>` and `<main>` (now in layout). All fetches, stat cards, recent ticks table, positions card, log viewer, and kill-switch button unchanged from Session 7. Still `export const dynamic = "force-dynamic"`.

**`site-header.tsx`** — Logo wrapped in `<Link href="/">` (was a plain div), `<MainNav />` rendered between logo and right-side controls. Otherwise unchanged.

**`empty-state.tsx`** — Shared helper for the new pages. Dashboard has its own inline copy — deliberately not migrated to keep the diff surgical.

### 2. Next 16 `next.config.ts` ESM/CJS interop bug — OOM crash-loop incident

Session 10 had written `frontend/next.config.ts` with `turbopack.root = path.dirname(fileURLToPath(import.meta.url))` to silence the "multiple lockfiles" warning. That fix was never verified. When I first ran `next dev` and `next build` this session, it exploded:

```
Failed to load next.config.ts
ReferenceError: exports is not defined
    at next.config.compiled.js:2:23
```

Root cause (diagnosed after 2 failed fixes): Next 16 compiles `next.config.ts` to CJS-style output (top-level `exports`) but then invokes the compiled file in an ESM-ish context where `exports` is undefined. Neither `import.meta.url` (ESM-only) nor `__dirname` (CJS-only) work reliably in that hybrid mode.

**My first fix attempt — `process.cwd()` in `next.config.ts`** — swapped the ESM construct for `process.cwd()`, assuming Next would pass the frontend dir as cwd. `next build` passed cleanly (!), so I thought it was fine. Then I ran `next dev` to verify my new pages rendered — but localhost:3000 hung forever. Probing the routes with curl showed `/` correctly redirected (307) to `/login`, but `/login` hung for 20+ seconds. Pulling dev server logs revealed:

```
Error: Can't resolve 'tailwindcss' in 'C:\Users\cryptomeda\Desktop\Swarm\myprojects\TradingBot'
  using description file: C:\Users\cryptomeda\Desktop\Swarm\myprojects\TradingBot\package.json
  looking for modules in C:\Users\...\TradingBot\node_modules
```

Turbopack was resolving modules from the **parent** directory (`TradingBot`), not `frontend/`. My `process.cwd()` wasn't the frontend dir inside the config's execution context — it was resolving to somewhere else during Next's config compile step, so `turbopack.root` pointed at `TradingBot/` instead of `TradingBot/frontend/`. That made Turbopack look for `tailwindcss` in the bot's non-existent `node_modules/tailwindcss`. And critically: Turbopack's resolver doesn't fail cleanly on "module not found" — **it spawns worker processes in a retry loop**. Each worker allocated memory before dying, faster than Windows could reclaim it.

**The OOM crash-loop:** every 100-300ms a new worker process would boot, fail, dump a 30-line native V8 stack trace (`FATAL ERROR: Zone Allocation failed - process out of memory` / `Fatal JavaScript out of memory: MemoryChunk allocation failed during deserialization` / `FATAL ERROR: Committing semi space failed`), and exit. The task output stream captured hundreds of these interleaved crash dumps. **VS Code froze. The whole laptop froze.** Had to `taskkill /F /IM node.exe /T` and clear `.next/` to stop it.

**Collateral damage — the LIVE bot died:** the bot was running in a separate PowerShell window ticking every 15 minutes on mainnet. Supabase query confirmed:

```
last_market_tick:  2026-04-11 16:41:25 UTC
last_risk_tick:    2026-04-11 16:41:26 UTC
last_log:          2026-04-11 16:41:26 UTC
now:               2026-04-11 19:37:58 UTC  (silence: 2h 56m)
```

The OOM loop starved the bot's `ts-node` process out of memory. Last tick: 16:41 UTC. No trades lost — bot was flat the whole time. A pending `kill_switch` command was sitting in `bot_commands` from the dashboard at 19:07 UTC; user had clicked it while the bot was silent. Confirmed no positions on exchange via `test_connection.ts` (manual, user ran it). **Ideal failure mode.** If a position had been open, we'd have been in a worse spot.

**Recovery:** user restarted the bot. The pending `kill_switch` command was auto-consumed by the startup sweep (now-retired path — see below), activating kill state with 0 closed positions, after which the user clicked Resume from the dashboard. Then user chose to restart in **DRY_RUN** instead of LIVE to build the remaining frontend + risk work under safer conditions. Bot has been ticking cleanly in DRY_RUN since 21:54 UTC (dashboard confirms).

**Definitive fix — switch to `next.config.js` (CJS):** Deleted `next.config.ts`. Created `next.config.js` (plain CommonJS) with:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
};

module.exports = nextConfig;
```

In a `.js` file, `__dirname` is always defined, always the directory of this file, always correct. No ESM/CJS interop, no cwd timing issues. This matches the canonical Next 16 docs example at `frontend/node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopack.md` **exactly**. Verified end-to-end:

- `npx next build` — clean, no "multiple lockfiles" warning
- `npx next dev` — Ready in 1.17s, no warning
- `curl http://localhost:3000/` → 307 → /login in ~15ms
- `curl http://localhost:3000/login` → 200 in 4.1s (first compile)
- `curl http://localhost:3000/{automation,trades,strategies}` → all 307 → /login in ~15ms each (routes registered, auth redirect working)

Closes task #22 for real this time.

### 3. Task #13 — risk manager state persistence

The session-10 OOM incident was a live demonstration of why task #13 matters: if the bot had been mid-trade when it died and restarted, `_state.dailyPnl` / `_state.pausedUntil` / `_state.consecutiveLosses` would have been **wiped** to zero, defeating the drawdown caps in `src/risk/manager.ts`. Specifically `dailyStartBankroll = 0` would have **silently disabled** the daily drawdown check at [src/risk/manager.ts:78](src/risk/manager.ts#L78) until the next trade closed.

**Design insight:** `writeRiskSnapshot()` already persists most of this state to `risk_snapshots` every tick — it just wasn't being read back. The fix is one-directional: restore the already-written state on startup.

**Schema change — migration 008** (`008_risk_snapshot_daily_start`):

```sql
ALTER TABLE public.risk_snapshots
  ADD COLUMN IF NOT EXISTS daily_start_bankroll NUMERIC;
```

Nullable for backward compat with existing rows. Applied via `mcp__supabase__apply_migration`. Only new field needed — everything else was already in the schema.

**`src/db/snapshots.ts`:**
- `writeRiskSnapshot()` now includes `daily_start_bankroll: s.dailyStartBankroll` in the insert row
- New `loadLatestRiskState(): Promise<HydratedRiskState | null>` — reads newest `risk_snapshots` row via `.maybeSingle()`. Returns a typed `HydratedRiskState` or `null`. Never throws (try/catch + error-swallowing `console.error`). `toNumber()` helper handles the Supabase numeric-as-string return format with fallback.

**`src/risk/state.ts`:**
- New exported `hydrateState(h: RiskStateHydration): void`
- Cross-day logic: if source snapshot's UTC day ≠ today, zero `dailyPnl` + `dailyStartBankroll`, advance `lastDailyReset` to today (fresh daily budget)
- Cross-week logic: same for ISO week / `weeklyPnl`
- `pausedUntil` clamped to 0 if in the past (expired pauses don't linger across restart)
- `killed` / `killedReason` preserved verbatim (manual kills survive crashes)
- `openPositions` / `totalExposureUsd` intentionally left at 0 — refreshed from Hyperliquid on first tick (authoritative source)
- `consecutiveLosses` carried unconditionally (not period-bound)

**`src/main.ts`:** hydration call inserted between `createMCPClient()` and `startCommandSubscription()`. This ordering matters — the command bus's pending-row sweep runs AFTER hydration, so the hydrated killed state is the baseline and any pending kill_switch rows apply on top. Guarded by try/catch with a `"Risk state hydration failed — using fresh state"` fallback log. On success, emits:

```
[Bot] Hydrated risk state from 2026-04-11T22:09:40.123Z — bankroll=$499.71 dailyPnl=$0.00 weeklyPnl=$0.00 losses=0 paused=no killed=false
```

**Test script — `src/scripts/test_risk_hydration.ts`** (5 cases, all pass):

| Part | Test | Result |
|------|------|--------|
| A | Integration: insert synthetic `risk_snapshots` row → `loadLatestRiskState()` → `hydrateState()` → assert 10 fields → delete by ID in finally block | ✅ |
| B | Cross-day: craft yesterday's takenAt, assert `dailyPnl` zeroed, `dailyStartBankroll` zeroed, `consecutiveLosses` carried, `bankroll` carried | ✅ |
| C | Expired `pausedUntil`: pass past timestamp, assert clamped to 0 | ✅ |
| D | Future `pausedUntil`: pass future timestamp, assert preserved | ✅ |
| E | Killed state: pass `killed=true` + reason, assert both survive | ✅ |

The integration test (Part A) writes a real row to Supabase and deletes it in a `finally` block even if asserts fail — no pollution in `risk_snapshots` history. Verified post-run: test row id=46 was cleaned up.

**Still not exercised in a real restart:** the actual bot startup hydration path (the test validates the functions, but the `main.ts` call site hasn't fired with hydration logic in a real restart yet). Will naturally happen on the next bot restart. See "Untested Code Paths" for the explicit flag.

### 4. Untested paths retired this session

| Path | Previously flagged | Retired via |
|------|--------------------|-------------|
| Risk manager state persistence | Session 6 (long-outstanding) | Test script 5/5 pass |
| Command bus startup sweep with actual pending commands | Session 8 | Real recovery — pending `kill_switch` from 19:07 UTC was consumed by the sweep on restart at 21:54 UTC, activated killed state with 0 closed positions, cleared by user's Resume click |
| Realtime reconnect during laptop freeze | implicit | The OOM froze the bot for 3h; on restart, the Realtime channel re-established cleanly and the pending command surfaced |

### 5. New issue discovered this session

**Next 16 `next.config.ts` is a trap on Windows.** TS config files get compiled to CJS output but invoked in ESM-ish context, so neither `import.meta.url` nor `__dirname` work reliably. `process.cwd()` is also unreliable because Next's config compiler may change cwd between load and execute. The canonical fix is to **use `next.config.js` (plain CommonJS) instead**, where `__dirname` is always correct. Documented in the file header comment. This cost us a 3-hour LIVE bot outage + a laptop freeze + the wasted time of two failed fixes. A memory entry should be saved to prevent repeating this pattern in other Next 16 projects.

### 6. Non-goals this session (deliberate)

- **Mobile hamburger nav.** `MainNav` is `hidden md:flex`. Mobile users see no nav. Acceptable for single-user desktop use.
- **Backtests page.** Task #17 is "Trades / Strategies / Automation / Backtests". Shipped the first three; skipped Backtests because no backtest engine exists yet — the page would be a stub reading from `backtest_runs` (0 rows, 0 foreseeable rows).
- **TV-sleep recovery (#21).** Medium-risk, touches the main loop's hot path. Deferred to avoid another LIVE-impacting change in the same session as the OOM incident.
- **Week-1 clamp removal.** Still not ready — no LIVE trade has fired, clamp logging still unobserved, and today's involuntary DRY_RUN demotion reset the clock. Target bumped.

## What Was Done (Session 14) — Aggressive sizing, per-strategy leverage, S3 scaled TPs

1. **Switched to margin-based position sizing** — new `calcMarginBasedSize()` in `src/risk/sizing.ts`. Each trade now allocates 5% of current bankroll as margin, then levers up. Portfolio compounds automatically: $500 → $600 bankroll means next trade uses $30 margin. Files: `src/risk/sizing.ts`, `src/main.ts`.

2. **Fixed per-strategy leverage** — `STRATEGY_LEVERAGE` map added to `src/strategy/confluence.ts` (S1=10x, S2=8x, S3=5x) with `getLeverageForSignals()` helper. Confluence scorer's variable leverage output is now ignored for order sizing; strategy identity determines leverage. When multiple strategies align, highest-priority wins (S1 > S2 > S3). Files: `src/strategy/confluence.ts`, `src/main.ts`.

3. **S3 scaled take-profits** — after any S3 entry, bot places three native Hyperliquid TP trigger orders: 33% of position at +1%, 33% at +3%, 34% at +5% from entry price. Uses existing `setScaledTakeProfits()` from `src/hyperliquid/orders.ts`. Removed the old soft 1% loop-tick TP check from `shouldExitS3`. S3 still exits on reverse Stoch RSI cross and 2h max hold. Files: `src/main.ts`, `src/strategy/s3_stoch_rsi.ts`.

4. **S1 and S2 exits unchanged** — kept indicator-based exits (S1: reverse EMA8/EMA55 cross; S2: PMARP reversal / BBWP expansion / EMA cross). No native TP orders for these strategies by design — S1 rides the trend, S2 exits when the overextension signal fires.

5. **Removed week-1 LIVE clamps** — deleted the 2x leverage cap and 1% risk cap block from `src/main.ts`. Restored `MAX_OPEN_POSITIONS = 3` in `src/risk/manager.ts`.

6. **BTC_TRADING_STRATEGY_KB.md updated** — bumped to v1.1, updated leverage table, position sizing formula, S3 exit conditions, confluence scoring table.

> **Bot needs restart** to pick up these changes. Ctrl+C current PS window → `$env:DRY_RUN="false"; npm start`.

## What Was Done (Session 15) — Manual trade card (dashboard → command bus → Hyperliquid)

1. **Bot restarted with Session 14 code** — clean startup: `[Bot] Hydrated risk state from 2026-04-13T23:38:30` confirmed, 3 ticks observed at 15-min cadence, all `No signals this tick` (bearish macro). Balance $499.47.

2. **TV sleep issue resolved** — Windows configured to never sleep. Marked task #21 closed.

3. **Manual trade card built and pushed** — 5 files changed, 2 commits pushed to GitHub (`f07f98a` + `fd745af`), Vercel auto-deploy triggered.

   **Bot side:**
   - `src/commands/handlers.ts`: `handleManualTrade(payload, ctx)` — validates direction/leverage/notional/SL/TPs, checks killed state + existing BTC position, fetches mark price, places market order, waits 3s, sets SL and up to 3 TP levels via `setTakeProfit`. Server-side validates SL/TP direction relative to mark price. Returns `{ entryPrice, sizeBase, slOid, tpOids, ... }`.
   - `src/db/commands.ts`: `manual_trade: handleManualTrade` added to HANDLERS.

   **Frontend side:**
   - `frontend/src/app/actions/commands.ts`: `"manual_trade"` added to `CommandType`; `issueCommand` now reads `result` column from `bot_commands` and returns it; `issueManualTrade(params)` wrapper added.
   - `frontend/src/components/manual-trade-card.tsx`: New Client Component. 2-col layout on desktop. Long/Short toggle (green/red), leverage + size inputs, SL price, 1–3 TP levels. Portions auto-split (100% / 50%+50% / 50%+25%+25%). `window.confirm` before submit. Success toast shows entry price + SL + TP count.
   - `frontend/src/app/(app)/page.tsx`: Card rendered between main grid and bot logs.

4. **Backtesting scoped for next session** — agreed approach: use `data_get_study_values` arrays (all visible bars per indicator) from TradingView MCP as historical data source. Build `src/scripts/backtest.ts` engine + frontend page.

## What To Do Next

> **Next session plan (Session 16):** Manual trade card deployed to Vercel. Main priorities:
>
> 1. **Test manual trade card end-to-end** — open dashboard, fill form (small size), submit, verify order on Hyperliquid + SL/TP on Open Orders + command row in Automation page.
> 2. **Wait for first LIVE strategy trade** — bearish macro persists. S3 short most likely first signal.
> 3. **Verify S3 TP placement** — after first S3 entry, confirm 3 TP orders appear on Hyperliquid Open Orders.
> 4. **Backtesting engine** — `src/scripts/backtest.ts` using TradingView MCP historical bar data + frontend page.

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | ~~Add `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to `.env.example`~~ | — | ✅ Done Session 7 by user. |
| 2 | ~~**Scaffold Next.js frontend**~~ | — | ✅ Done Session 7. See Session 7 writeup below. |
| 3 | **Phase 2 — Command bus (frontend → bot)** | med | ✅ **Kill switch + Resume done in Session 8** (DRY_RUN verified end-to-end). Still open: pause/unpause commands, strategy param live-edits (needs Strategies page), Realtime reconnect with backoff, command history viewer. See Session 8 writeup. |
| 4 | ~~Test `placeMarketOrder` **short** direction~~ | — | ✅ **Done Session 9.** `test_micro_trade.ts short` — $0.0183 cost. |
| 5 | ~~Test `setStopLoss` for **short** position~~ | — | ✅ **Done Session 9.** `test_stop_loss.ts short` — $0.0189 cost. Buy-stop confirmed on book with `reduceOnly: true`. |
| 6 | ~~Test `placeLimitOrder` **GTC** (both directions)~~ | — | ✅ **Done Session 9.** `test_limit_order.ts` — $0.0000 cost, both directions validated. |
| 7 | Exercise `syncPositions` upsert path | low | Session 9 side effect: the old DRY_RUN bot (running in PS window) may have observed the brief positions during validation tests and triggered `syncPositions` via its 15-min tick. Unverified — check `bot_logs`/`positions` table around Session 9's tick window in Supabase to confirm. If not, first LIVE trade exercises it naturally. |
| 8 | Exercise `insertClosedTrade` code path | low | Still untested — DRY_RUN won't close trades, and Session 9's test scripts bypass the main loop. Will fire naturally on first LIVE trade close. |
| 9 | ~~Tighten risk caps before LIVE~~ | — | ✅ **Done Session 9.** Max 1 concurrent (in `manager.ts`), max 2x leverage + 1% risk (in `main.ts` week-1 clamp block). Typecheck clean. Remove both after first LIVE week. |
| 10 | ~~DRY_RUN → LIVE transition~~ | — | ✅ **Done Session 10 (2026-04-11 09:38 UTC).** 4-stage procedure executed cleanly. 7 LIVE ticks observed, all clean. Bankroll unchanged. Kill switch validated in LIVE path. Bot still running as of wrap. |
| 11 | ~~Add stop-loss cleanup on position exit~~ | — | ✅ **Done Session 9.** `cancelOpenBtcStops()` embedded in `closePosition`. Validated end-to-end via `test_stop_cleanup.ts`. Bonus finding: Hyperliquid natively removes reduce-only triggers on position close, so our helper is a defensive safety net. |
| 12 | ~~Graceful MCP reconnect on tradingview-mcp crash~~ | — | ✅ **Done Session 13.** Retry with exponential backoff (3 attempts, 2s/4s/8s) + full reconnect (new child process) on persistent failure. Bot restarted with new code, clean tick observed. |
| 13 | ~~Risk manager state persistence~~ | — | ✅ **Done Session 11.** Migration 008 added `daily_start_bankroll` column; `loadLatestRiskState()` + `hydrateState()` + 5-case `test_risk_hydration.ts`. Test passes 5/5. Real-world startup hydration path still untested — will fire on next bot restart. |
| 14 | Tighten the 15 `rls_policy_always_true` advisor warnings | low | From Session 6 — safe for single-user, **must** be tightened if we ever add a second user. Gate INSERT/UPDATE/DELETE on `auth.uid() = <user_id>` for user-controlled tables (`alert_configs`, `backtest_runs`, `bot_commands`, `journal_entries`, `strategy_configs`). |
| 15 | Install `jq` to activate remaining safety hooks | low | `winget install jqlang.jq` + restart VS Code. **Note:** `protect-files.sh` already works without jq (blocked `.env` edits all session). |
| 16 | Add a `[Portfolio]` prefix to `src/logger/portfolio.ts` lines | trivial | Cosmetic — Portfolio stats logs default to source `main` in `bot_logs`. |
| 17 | Frontend — build Trades / Strategies / Automation / Backtests pages | low | ✅ **Trades / Strategies / Automation DONE Session 11** — see Session 11 writeup section 1. Still open: **Backtests page stub** (reading from `backtest_runs` — 0 rows today, minimal value until a backtest engine exists; deferrable). |
| 18 | ~~Frontend — add email allowlist to prevent random OTP sign-ups~~ | — | ✅ **Done Session 13.** User disabled "Allow new users to sign up" in Supabase Auth settings. Only existing `contact@mdntech.org` account can log in. |
| 19 | ~~Frontend — wrap the dashboard in a `(app)` route group with a shared layout~~ | — | ✅ **Done Session 11.** Refactor landed alongside the new Trades/Strategies/Automation pages. Layout fetches user once, renders `<SiteHeader>` + `<main>` wrapper. Closes this item. |
| 20 | ~~**Remove week-1 LIVE clamps**~~ | — | ✅ **Done Session 14.** Clamp block deleted from `src/main.ts`, `MAX_OPEN_POSITIONS` restored to 3 in `manager.ts`. Replaced with permanent per-strategy fixed leverage (S1=10x, S2=8x, S3=5x) and margin-based sizing (5% of bankroll). |
| 21 | ~~**TradingView Desktop state loss on Windows sleep**~~ | — | ✅ **Resolved Session 15.** Windows configured to never sleep. |
| 22 | ~~**Verify frontend `turbopack.root` fix landed**~~ | — | ✅ **Done Session 11 — the hard way.** Session 10's `next.config.ts` was actually broken (ESM/CJS interop, `ReferenceError: exports is not defined`). Session 11's first follow-up (`process.cwd()`) was ALSO broken — caused the Turbopack OOM crash-loop that froze the laptop and killed the LIVE bot for 3h. **Final fix:** switched to `next.config.js` (CJS) using `__dirname`, which matches the canonical Next docs example and works first-try. Verified end-to-end: `next build` clean, `next dev` ready in 1.17s, all 4 app routes respond correctly. See Session 11 writeup section 2 for the full incident postmortem. |
| 23 | **Frontend Backtests page stub** | trivial | Only remaining piece of task #17. Reads `backtest_runs` — currently 0 rows. Adds `(app)/backtests/page.tsx` with a table that shows an empty state until a backtest engine exists. Zero-risk UI work, defer until backtest engine is built. |
| 24 | ~~**Frontend mobile nav**~~ | — | ✅ **Done Session 12.** Bottom tab bar with 5 icons, hidden on desktop, safe area padding. |
| 25 | **Frontend command execution toast** | trivial | Current `KillSwitchButton` shows sonner toast on result but not on command submission. Quick UX polish: show "Kill command sent…" immediately, then replace with the result toast when the bot finishes. |
| 26 | ~~**Real LIVE restart to exercise hydration path**~~ | — | ✅ **Done Session 12.** LIVE restart emitted `[Bot] Hydrated risk state from 2026-04-11T21:28:13` with correct values. |
| 27 | ~~**Supabase Auth: update Site URL + Redirect URLs for Vercel**~~ | — | ✅ **Done Session 13.** User updated Site URL to `https://trade-kit.vercel.app` and added redirect URL `https://trade-kit.vercel.app/**`. Login tested end-to-end on production. |
| 28 | ~~**Frontend: add Vercel env vars**~~ | — | ✅ **Done Session 13.** User added `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Vercel dashboard. |
| 29 | **Verify manual trade Supabase logging** | low | `test_custom_trade.ts` logs to `trades` table with `source: "manual"`, but no trade has completed end-to-end yet (all were killed early or script restarted). Run one trade to SL/TP completion and confirm it appears on the Trades page. |
| 30 | ~~**Wire take-profits into bot strategies**~~ | — | ✅ **Done Session 14 (S3).** S3 now places 3 native TP orders at entry: 33%@+1%, 33%@+3%, 34%@+5%. S1 and S2 keep indicator-based exits by design (trend-ride / PMARP-BBWP). |
| 31 | **Multi-asset support (ETH/SOL)** | high | User interested. Requires new TV charts + indicators, strategy params per asset, dynamic asset index in orders module, risk manager changes for concurrent cross-asset positions. Major architectural expansion. |
| 32 | **Test manual trade card end-to-end** | med | Session 15 built but not yet tested from dashboard. Open Vercel app, fill form, submit, verify: order on Hyperliquid, SL + TP orders on Open Orders, `bot_commands` row status=done, toast success. Use small size ($20–30). |
| 33 | **Backtesting engine** | med | Use TradingView MCP `data_get_study_values` arrays (all visible bars per indicator) as historical data. Build `src/scripts/backtest.ts` + frontend backtests page. Scope: 15m chart, zoom out ~500 bars, replay S1/S2/S3 logic bar-by-bar, output equity curve + per-trade stats. |

## Untested Code Paths

| Code | Why untested | Risk if broken |
|------|--------------|----------------|
| ~~`placeMarketOrder` (short direction)~~ | ✅ **Validated Session 9** — `test_micro_trade.ts short`, clean fill + close | — |
| ~~`setStopLoss` (short position)~~ | ✅ **Validated Session 9** — `test_stop_loss.ts short`, buy-stop confirmed on book with `reduceOnly: true` | — |
| ~~`placeLimitOrder` (GTC, both directions)~~ | ✅ **Validated Session 9** — `test_limit_order.ts`, both directions placed + canceled, $0 delta | — |
| ~~Stop-loss auto-cancel on position close~~ | ✅ **Validated Session 9** — `test_stop_cleanup.ts`. Also discovered Hyperliquid natively removes reduce-only triggers on close | — |
| ~~`main.ts` long-running loop~~ | ✅ **Validated Session 3** — 12 consecutive ticks, 15-min cadence, ~2.5h clean run | — |
| ~~Risk manager state persistence~~ | ✅ **Validated Session 11** — `test_risk_hydration.ts` 5/5 pass (integration + unit). Migration 008 + `loadLatestRiskState()` + `hydrateState()`. Real-restart call-site still unobserved (see new entry below). | — |
| ~~**Risk state hydration on real bot startup (Session 11)**~~ | ✅ **Validated Session 12** — LIVE restart at session start emitted `[Bot] Hydrated risk state from 2026-04-11T21:28:13` with correct values (bankroll=$499.71, dailyPnl=$0, losses=0, paused=no, killed=false). | — |
| ~~**`daily_start_bankroll` column writes from live bot (Session 11)**~~ | ✅ **Validated Session 12** — bot restarted with Session 11's code; new `risk_snapshots` rows now include `daily_start_bankroll` values. | — |
| **Command bus startup sweep with actual pending commands (retired)** | ✅ **Validated Session 11** (unintentionally) — pending `kill_switch` from 19:07 UTC was consumed by the startup sweep when the bot restarted at 21:54 UTC after the OOM incident. Activated killed state with 0 closed positions. | — |
| **`insertClosedTrade` (Session 6)** | DRY_RUN doesn't close trades — code path never runs | Closed trades silently fail to persist on first LIVE close; audit trail missing |
| **`syncPositions` upsert path (Session 6)** | Still unverified. The old DRY_RUN bot may have seen brief positions during Session 9's test windows — but even so, Session 10's LIVE bot has had 0 positions the whole time. Will fire naturally on first LIVE trade entry. | Open positions wouldn't appear in `positions` table on first LIVE trade |
| **`syncPositions` stale-delete path (Session 6)** | Requires transitioning from N positions → N-1 | Stale closed positions linger in `positions` table |
| **Week-1 leverage clamp (Session 9)** | No signal has fired under Session 9/10's code yet. The pre-flip S3 long at 00:39 UTC was seen by OLD code. 7 LIVE ticks with new code = 0 signals. | If the clamp math is wrong, the first LIVE signal would bypass the cap and use KB-default 3-10x leverage |
| **Week-1 risk clamp (Session 9)** | Same reason as above — no signal fired under new code yet | First LIVE signal would use KB-default 2-5% risk instead of clamped 1% |
| **`MAX_OPEN_POSITIONS=1` gate (Session 9)** | Requires 2 signals to hit in the same session | The second position would attempt to open — blocked at `canTrade` gate, but the gate code path for "max reached" has been untested under the new constant |
| **`cancelOpenBtcStops` "canceled > 0" branch (Session 9)** | Hyperliquid's native auto-removal of reduce-only triggers meant our helper found 0 stops in the test. The `stops.length > 0` path with its batch-cancel call and oid log line never executed. | Only fires if Hyperliquid changes behavior; low real-world risk but the code path is unverified |
| **`cancelOpenBtcStops` empty-position path (Session 9)** | `closePosition` calls it in the "no position to close" early return. Never exercised in tests. | Stale stops from crashed prior sessions wouldn't get scrubbed — but that's the same failure mode we have today, so arguably no regression |
| **Stop-placement retry on entry failure (residual risk)** | Not implemented. If `setStopLoss` fails after a successful entry, position is briefly naked. | First LIVE flaky-network moment could leave a position without a stop until the next loop tick or manual intervention |
| **Log sink `SIGINT/SIGTERM` flush (Session 6)** | Bot hasn't been Ctrl-C'd since sink installed | Last ~2s of logs lost on clean shutdown |
| **Log sink `beforeExit` flush (Session 6)** | Event loop hasn't drained naturally | Same — last logs possibly lost |
| **Log sink buffer overflow drop-oldest (Session 6)** | Buffer cap 200, steady rate ~30 lines/tick | Oldest logs silently dropped during a burst — `getDroppedCount()` metric exists but unmonitored |
| **Frontend `proxy.ts` session-refresh cookie write (Session 7)** | Only exercised the fresh-login path so far. Token hasn't needed a refresh mid-session yet | If the refresh cookie write fails silently, user will be randomly logged out after the access token expires (~1h) |
| **Frontend sign-out button (Session 7)** | Never clicked — user has been testing sign-in only | Sign-out POST to `/auth/signout` could fail and leave a stale session cookie |
| **Frontend proxy matcher edge cases (Session 7)** | Matcher regex excludes static files + images. Not tested against `.webmanifest`, `favicon.*`, or nested public files | Could unintentionally gate or expose a file path |
| **Frontend error page / bad OTP flow (Session 7)** | Callback route handles missing `code` and exchange failure by redirecting to `/login?error=...`, but `/login` doesn't render the error message | Bad magic link → redirect loop with silent failure |
| **`exchangeCodeForSession` in `auth/callback/route.ts` (Session 7)** | Ran exactly once on first sign-in this session | Future OAuth providers / repeat sign-ins untested |
| **Kill switch close-all in LIVE mode (Session 8)** | DRY_RUN skipped the Hyperliquid close calls — only the "no positions to close" branch ran in verification | First LIVE kill with real positions could fail to close; may leave positions open while dashboard shows "killed". Gate on first LIVE trade. |
| **`handleManualTrade` full path (Session 15)** | Built but never triggered from dashboard. The entire dashboard → `issueManualTrade` → `bot_commands` INSERT → Realtime delivery → `handleManualTrade` → Hyperliquid orders path is untested. | Bad SL/TP logic, order rejection, or rounding bug could place an unprotected position. Test with small size ($20–30) from Vercel app before relying on it. |
| ~~**Command bus startup sweep with actual pending commands (Session 8)**~~ | ✅ **Validated Session 11** — pending `kill_switch` from 19:07 UTC consumed on restart at 21:54 UTC after OOM recovery (see Session 11 writeup). The claim → execute → write-back cycle ran end-to-end against a real pending row. | — |
| **Command handler failure path (Session 8)** | All verification commands succeeded — the `status='failed'` + `error` write-back branch never executed | A failing handler might not write its error back correctly; dashboard would see a command stuck in `running` forever |
| **Realtime reconnect after WebSocket drop (Session 8)** | No network hiccups during verification | Commands silently ignored after a brief drop; no backoff/retry implemented; user would click buttons with no effect until next bot restart |
| **Frontend action 15s timeout path (Session 8)** | Bot responded in ~300–500 ms every time | If the bot is slow (LIVE multi-position close) or offline, timeout message shown — not verified that the error toast renders correctly |
| **`setKilled` exposure zero-out (Session 8)** | Always called from `handleKillSwitch` when `activePositions[]` was empty | If the bot ever enters killed state WHILE holding positions, the zeroing-out behavior hasn't been observed in a real state transition |
| **MCP reconnect under real failure (Session 13)** | Implemented retry + reconnect but no real TradingView crash has occurred since deployment | If the reconnect logic has a bug (e.g., transport teardown doesn't actually kill child process), the bot would loop-fail every tick instead of recovering |
| **`calcMarginBasedSize` in a live trade (Session 14)** | Bot not restarted with new code yet — no trade has fired under the new sizing logic | Sizing wrong → position too large (over-leveraged) or too small (underutilized) |
| **S3 scaled TPs via `setScaledTakeProfits` in main loop (Session 14)** | TP code path in `main.ts` is new — only `test_custom_trade.ts` has exercised `setScaledTakeProfits` previously | TPs not placed after S3 entry; position runs unmanaged to reverse-cross or 2h timeout |
| **Per-strategy leverage (10x/8x/5x) under live conditions (Session 14)** | `getLeverageForSignals()` is new; no trade has fired under it yet | Wrong leverage applied to first real trade |
| **`setTakeProfit` trigger execution (Session 13)** | TP orders placed and confirmed on Hyperliquid Open Orders, but no TP has actually triggered (trades closed manually or via kill switch) | If Hyperliquid's TP trigger behavior differs from SL (e.g., partial fill semantics), the TP might not execute as expected |
| **`setScaledTakeProfits` partial fill cascade (Session 13)** | 3 TP orders confirmed on book, but no partial TP has triggered yet | If TP1 fires but the remaining TPs reference stale position size, they might fail or behave unexpectedly |
| **`insertClosedTrade` with `source: "manual"` (Session 13)** | Test trades were all closed via kill switch or Ctrl+C before the Supabase write executed | The Supabase insert with the new `source` column hasn't been confirmed end-to-end yet |
| **Isolated margin liquidation price (Session 13)** | Switched from cross to isolated; no position has gotten close to liquidation | Isolated liquidation price is much closer than cross — verify it's visible on dashboard and that risk manager accounts for it |
| **Kill switch's `clearActivePositions` callback (Session 8)** | Never had non-empty `activePositions[]` during testing | Bug in the callback wiring could leave stale in-memory tracking after a LIVE kill |

## Risk Configuration

**Portfolio-level (in `src/risk/manager.ts`):**
- Max concurrent positions: **3**
- Max total exposure: **60%** of bankroll
- Daily drawdown limit: **10%** → 24h pause
- Weekly drawdown limit: **15%** → 48h pause
- Consecutive loss limit: **3** → 4h pause

**Per-trade sizing (margin-based, Session 14):**
- Margin per trade: **5% of current bankroll** (e.g. $25 at $500 bankroll)
- S1 leverage: **10x** → $250 notional at $500 bankroll
- S2 leverage: **8x** → $200 notional at $500 bankroll
- S3 leverage: **5x** → $125 notional at $500 bankroll
- Portfolio compounds: bankroll updates each trade, next trade's margin = 5% of new bankroll

**Effective exposure at $499.82 bankroll:**
- S1 trade: $24.99 margin → $249.90 notional
- S2 trade: $24.99 margin → $199.92 notional
- S3 trade: $24.99 margin → $124.95 notional
- Daily drawdown trip: ~$50 → 24h pause
- Weekly drawdown trip: ~$75 → 48h pause

## Background Processes (when you last left)

- **TradingView Desktop** with CDP port 9222 — user relaunched mid-Session 11 after the OOM incident. Chart is `BINANCE:BTCUSDC` with 9 indicators loaded. Relaunch via `launch_tradingview.ps1` if needed.
- **LIVE bot** — ⚠️ **RUNNING but stale** — still running Session 13 code. **Must restart** to pick up Session 14 changes (new sizing, leverage, S3 TPs). Ctrl+C → `$env:DRY_RUN="false"; npm start`. Killed state: `false`. Balance ~$499.82. 0 positions, 0 orders.
- **DRY_RUN bot (Session 11)** — 💀 **DEAD.** Replaced by the Session 12 LIVE bot above.
- **LIVE bot (Session 10)** — 💀 **DEAD.** Replaced during Session 11 recovery.
- **tradingview-mcp** — spawned as a child by the active bot. Lives as long as the parent. Will die on Ctrl+C of the bot.
- **Old DRY_RUN bot (Session 8 legacy)** — 💀 **DEAD.** Shut down cleanly during Session 10 Stage 1 (SIGINT flush confirmed). Do not resurrect — its code was stale.
- **Supabase project** `gseztkzguxasfwqnztuo` — Phase 1 schema + command bus realtime publication applied. 11 tables, RLS, **8 migrations (new: 008_risk_snapshot_daily_start — adds `daily_start_bankroll NUMERIC NULL` column to `risk_snapshots` for restart hydration, Session 11).** New rows from Session 11: additional `bot_commands` (pending kill_switch at 21:07 UTC consumed on recovery, plus manual resume), more `market_snapshots` / `risk_snapshots` / `bot_logs` from the pre-incident LIVE ticks and post-incident DRY_RUN ticks. No `trades` or `positions` rows from Session 11 (no signals fired under either mode). Test script `test_risk_hydration.ts` wrote + deleted one synthetic `risk_snapshots` row (id=46, cleaned up in finally block).
- **Supabase Auth** — **LIVE.** Magic-link sign-in still works from Session 7 cookie. One user in `auth.users` (mjerabek1@gmail.com). **Site URL** set to `http://localhost:3000`, **Redirect URLs** includes `http://localhost:3000/auth/callback`. If you deploy, add the prod URL(s).
- **Supabase API keys** — **Migrated to new format** (Session 7). Unchanged this session. Legacy JWTs fully disabled at project level. Bot's `.env` uses `SUPABASE_SERVICE_ROLE_KEY=sb_secret_...` (the `radingbot2` secret key). Frontend uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` (the `default` publishable key). See `memory/supabase_new_api_keys.md`.
- **Supabase MCP** — **LIVE and working.** Session 5 workaround (a) still persistent. Same config as Sessions 6/7/8/9 — no action needed.
- **Supabase Realtime** — **LIVE.** Bot holds a WebSocket channel named `bot_commands_stream` subscribed to `postgres_changes` INSERT events on `public.bot_commands`. Auto-reconnect validated Session 10; pending-row sweep validated Session 11 (pending kill_switch consumed on post-OOM restart).
- **Supabase log sink** — still installed in the current DRY_RUN bot process. `SIGINT` flush validated across multiple Ctrl+C events in prior sessions. `beforeExit`/buffer-overflow paths still untested.
- **Frontend dev server** — may or may not be running on http://localhost:3000. Session 12 did repeated `next build` but dev server state is unknown. All 5 app routes (/, /market-data, /trades, /strategies, /automation) respond correctly. **Vercel deployment** at `trade-kit.vercel.app` auto-deploys on push to `main`.
- **Safety hooks** — partially active. `protect-files.sh` worked without jq through this session too. Install jq to activate the remaining hooks (audit-all, scan-injection, block-dangerous, block-internal-urls).

## Security Notes

- `HYPERLIQUID_PRIVATE_KEY` in `.env` is the **API wallet** key (trade-only, no withdraw). This is the safer design — even if `.env` leaks, the attacker cannot steal funds, only make bad trades.
- `HYPERLIQUID_WALLET_ADDRESS` is the **master MetaMask address** (holds the actual funds). The API wallet signs trades on behalf of this master account.
- The first API wallet key was briefly visible in chat when I had to read `.env` to debug a config issue. It was rotated immediately afterward — current key is the second-generation one.
- NEVER put the main MetaMask private key in `.env`. It has full withdrawal permissions.
- **Session 2 — Supabase:** `SUPABASE_SERVICE_ROLE_KEY` bypasses ALL Row Level Security. Lives only in `.env` (bot, trusted local). **Never** in `frontend/.env.local` — anything with `NEXT_PUBLIC_` prefix or any frontend import ships to browsers. Anon key is designed to be public; service role is not.
- **Session 2 — `.env*` hook protection:** `.claude/hooks/protect-files.sh` blocks Claude from Write/Edit on any `.env*` file. User must edit these manually. (Hook is inert until jq is installed, but still — don't rely on Claude to touch these files.)
- **Session 2 — AuthVault PAT exposure flagged:** `C:\Users\cryptomeda\.claude.json` contains a plaintext Supabase PAT `sbp_...` in the AuthVault project's `mcpServers` block (old stdio/npx format). Recommend rotating and migrating AuthVault to the new HTTP/OAuth format used by TradingBot. Not urgent but non-zero risk if the config file leaks.
- **Session 2 — MCP audit gap:** Safety hooks match on `Bash|WebFetch|WebSearch|Read|Grep|Task`. Supabase MCP tool calls (`mcp__supabase__*`) are **not** audited or scanned. Fine for a trusted first-party server, but be aware.
- **Session 7 — Supabase service role key rotation.** The original legacy `service_role` JWT was briefly read into Claude's conversation context when `.env.example` was Read after the user (accidentally) pasted real secrets into it. The file was sanitized immediately, then the key was rotated as a precaution via the new Supabase API key system: created a new `sb_secret_...` key (`radingbot2`), put it in `.env`, restarted the bot, verified writes landed, deleted the old `default` secret key, clicked "Disable JWT-based API keys" at the project level. The legacy JWT is now fully revoked. Lesson: **never Read `.env.example`** in a session unless the user explicitly asks — it may transiently contain real secrets during user editing.
- **Session 7 — Frontend threat surface:** the frontend uses the publishable key (`sb_publishable_...`) in the browser. This is designed to be public. RLS is the enforcement boundary. Current SELECT policies on `market_snapshots`, `risk_snapshots`, `bot_logs`, `positions`, `trades` are `authenticated + true`. If a second user is ever added to the project, they'll see everything — single-user design assumption. Tighten to `auth.uid() = <your_user_id>` before any multi-user scenario.
- **Session 7 — Frontend auth allowlist missing:** Supabase magic link will auto-create a user for ANY email that signs in. For personal use on localhost this is fine; before exposing the frontend publicly, add an allowlist (Supabase Auth hook or a check in `auth/callback/route.ts` that rejects non-allowlisted emails). Tracked as task #18 in "What To Do Next".

## Resuming in a new chat

1. Open a new Claude Code chat
2. Type `/start`
3. I'll read this file + check environment state + present a session briefing with What To Do Next
