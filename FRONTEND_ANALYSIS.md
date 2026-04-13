# TradingBot Frontend — Analysis & Architecture

> Drafted 2026-04-10. Source of truth for scope, architecture, data model,
> and phased implementation of the TradingBot web frontend.

## 1. Executive Summary

A single-user Next.js 15 web app deployed on Vercel, giving you a remote
control surface for the Hyperliquid trading bot running on your Windows
machine. Five pages: **Dashboard**, **Trades**, **Strategies**,
**Automation**, **Logs**. Supabase is the shared state + message bus
between Vercel and the local bot — no Cloudflare Tunnel, no public
exposure of the local machine. Clean, professional, light/dark.

### Key decisions (locked in)

| Area | Decision |
|------|----------|
| Frontend host | Vercel |
| Bot \u2194 Frontend transport | **Supabase (Postgres + Realtime)** — not HTTP tunnel |
| UI framework | Next.js 15 App Router |
| Component library | shadcn/ui + Tailwind + Radix primitives |
| Charts | Recharts for most, Lightweight Charts (TradingView's library) for candles |
| Data fetching | TanStack Query + Supabase Realtime subscriptions |
| Auth | Single-user (Supabase Auth, magic link to your email) |
| Strategy editing scope | Config/params only (no codegen, no rebuild) |
| Storage | Supabase Postgres (+ Supabase MCP for dev-time access) |
| Destructive action UX | Confirm dialogs only on destructive actions |
| Theme | Light/dark toggle, clean professional |

---

## 2. Architecture

```
                    \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510
                    \u2502   Vercel \u2014 Next.js 15   \u2502
                    \u2502  \u2022 Dashboard           \u2502
                    \u2502  \u2022 Trades              \u2502
                    \u2502  \u2022 Strategies          \u2502
                    \u2502  \u2022 Automation          \u2502
                    \u2502  \u2022 Logs                \u2502
                    \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518
                              \u2502 HTTPS
                              \u25bc
                    \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510
                    \u2502       Supabase          \u2502
                    \u2502  Postgres + Realtime    \u2502
                    \u2502  Auth + Row-Level Sec   \u2502
                    \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2568\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518
                              \u2568 write state + subscribe to commands
                              \u25bc
            \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510
            \u2502       Windows machine (you)              \u2502
            \u2502                                          \u2502
            \u2502   TradingView Desktop (CDP :9222)        \u2502
            \u2502             \u2502                            \u2502
            \u2502             \u25bc                            \u2502
            \u2502   tradingview-mcp (child proc)           \u2502
            \u2502             \u2502                            \u2502
            \u2502             \u25bc                            \u2502
            \u2502   Trading bot (src/main.ts)              \u2502
            \u2502       \u251c\u2500 Supabase client (writes state) \u2502
            \u2502       \u251c\u2500 Command listener (realtime)    \u2502
            \u2502       \u251c\u2500 PowerShell executor            \u2502
            \u2502       \u2514\u2500 Hyperliquid SDK                \u2502
            \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518
```

### Why Supabase-as-bus instead of a local HTTP bridge

- **Zero local network exposure** — your Windows machine never opens an
  inbound port to the internet. Private keys stay behind the firewall.
- **Realtime out of the box** — both Vercel and the bot subscribe to
  Postgres changes. Live dashboard updates without running a WebSocket
  server yourself.
- **Works when the bot is offline** — Vercel still renders
  last-known-state from Supabase. Closed trades, history, journal
  entries all available even when your PC is off.
- **Simpler auth model** — Supabase Auth protects both sides with the
  same JWT. No shared-secret header juggling.
- **Supabase MCP** — you can already grant me direct DB access during
  development for schema changes and debugging.

### Command pattern (how the frontend controls the bot)

Instead of RPC, the frontend inserts rows into a `bot_commands` table.
The bot subscribes to new rows via Supabase Realtime and executes them.

```
[Vercel]                     [Supabase]                  [Local bot]
    \u2502                            \u2502                            \u2502
    \u251c\u2500 INSERT bot_commands \u2500\u2500\u2500\u25b6\u2502                            \u2502
    \u2502   { type: "launch_tv" }    \u2502                            \u2502
    \u2502                            \u251c\u2500 realtime notify \u2500\u2500\u2500\u2500\u2500\u2500\u25b6\u2502
    \u2502                            \u2502                            \u251c\u2500 spawn PS1
    \u2502                            \u2502\u25c0\u2500\u2500 UPDATE (status=done) \u2500\u2524
    \u2502\u25c0\u2500 realtime notify \u2500\u2500\u2500\u2500\u2524                            \u2502
    \u2502                            \u2502                            \u2502
```

Command types (initial set):
- `launch_tradingview` \u2014 spawns `launch_tradingview.ps1`
- `start_bot` / `stop_bot` \u2014 manages the main.ts loop
- `kill_switch` \u2014 immediate halt, cancels all pending orders
- `pause_trading` / `resume_trading` \u2014 soft pause flag
- `close_position` \u2014 market-closes a specific position
- `run_test_script` \u2014 runs a known test script by name
- `run_backtest` \u2014 queues a backtest job
- `reload_strategies` \u2014 re-reads strategy_configs from DB

---

## 3. Pages

### 3.1 Dashboard (`/`)

The at-a-glance view of current market setup and bot health. This is the
landing page.

**Sections (top to bottom, left to right):**

1. **Hero KPIs row** (4 cards):
   - Bankroll (USDC, % change 24h)
   - Open P&L (live, color-coded)
   - Total P&L (all-time)
   - Bot status (RUNNING / DRY_RUN / PAUSED / STOPPED) with last-tick timestamp

2. **Market setup panel** (main focus):
   - BTC current price, 24h change, funding rate
   - Multi-timeframe confluence matrix (15m / 1H / 4H / 1D) showing:
     - EMA 8/13/21/55/200 values + alignment badges
     - RSI 14
     - Stoch RSI K/D
     - BBWP (volatility)
     - PMARP
   - Daily EMA 200 macro filter status (above/below)
   - Live signal preview for all 3 strategies (green/yellow/red + reason)

3. **Open positions card**:
   - List of current positions (side, size, entry, mark, PnL, liq price)
   - Quick-close buttons (with confirm dialog)

4. **Candlestick chart**:
   - BTC/USDC on the current primary timeframe
   - Overlays: EMAs, position entry/exit markers, stop-loss lines
   - Library: Lightweight Charts (TradingView's own open-source lib)

5. **Risk status strip**:
   - Daily drawdown used / limit (progress bar)
   - Weekly drawdown used / limit
   - Consecutive loss counter
   - "Pause state" — if paused, how much time remaining

**Data sources:**
- `market_snapshots` table (bot writes every tick) \u2192 multi-TF matrix
- `positions` table (bot syncs from Hyperliquid) \u2192 open positions
- `risk_snapshots` table \u2192 drawdown state
- Supabase Realtime subscriptions for all of the above

---

### 3.2 Trades (`/trades`)

Full trade history, analytics, and equity curve.

**Sections:**

1. **Tabs: Open | Closed | All**

2. **Headline metrics:**
   - Total trades, win rate, profit factor, Sharpe ratio
   - Average win / average loss / largest loss
   - Best and worst trade

3. **Equity curve chart:**
   - Cumulative P&L over time
   - Toggleable overlays: per-strategy equity curves
   - Drawdown shaded underneath

4. **Per-strategy performance table:**
   - S1 / S2 / S3 + custom: trades, win rate, avg R, total P&L, Sharpe

5. **Trade list table (main):**
   - Columns: Date, Strategy, Side, Size, Entry, Exit, P&L, Duration, Status
   - Filter by strategy, side, date range, P&L sign
   - Sort by any column
   - Row click \u2192 detail drawer

6. **Trade detail drawer** (opens from list row):
   - Entry conditions that fired (which strategy, which TF confluence)
   - Candle chart frozen around the entry and exit
   - Fees paid, slippage vs expected
   - Attached journal note + TradingView screenshot
   - Edit note inline

**Data sources:**
- `trades` table (bot writes on entry and exit)
- `journal_entries` table (user writes via UI)

---

### 3.3 Strategies (`/strategies`)

Manage the 3 built-in strategies and create parameter-tuned variants.

**Sections:**

1. **Strategy list (card grid):**
   - One card per strategy config, showing:
     - Name, template (S1/S2/S3), enabled toggle
     - Key params summary (risk %, max leverage)
     - Live win rate + recent P&L
     - Action buttons: Edit, Duplicate, Disable, Delete (with confirm)

2. **Create new variant modal:**
   - "Duplicate from" dropdown (any existing strategy)
   - Name field
   - Param form (auto-generated from the template's param schema)
   - Save \u2192 inserts into `strategy_configs` + bot picks up via
     `reload_strategies` command

3. **Strategy detail view** (click a card):
   - All params as editable form fields grouped logically:
     - **Entry conditions:** EMA periods, RSI thresholds, BBWP caps
     - **Timeframes:** primary, filter, trigger
     - **Exit rules:** stop-loss R, take-profit R, trailing
     - **Risk:** base risk %, leverage, confluence boost
   - Live param diff against base template
   - Performance tab: all trades this variant has taken
   - Save \u2192 versions the row (`strategy_configs` keeps history)

**Notes:**
- Strategies remain as TypeScript in `src/strategy/*.ts`. What's stored
  in Supabase are **parameter sets** bound to a template name. The bot
  loads all enabled `strategy_configs` at startup and re-loads on
  `reload_strategies` command.
- "Duplicate" = insert new row with `template = <same>`, copied params,
  new name.

**Data sources:**
- `strategy_templates` (seed data, matches TS files)
- `strategy_configs` (user-created variants)
- `trades` joined on `strategy_config_id`

---

### 3.4 Automation (`/automation`)

One-click runners for operational tasks you currently do via PowerShell.

**Sections:**

1. **System controls:**
   - Launch TradingView (runs `launch_tradingview.ps1`)
   - Start bot (DRY_RUN) / Start bot (LIVE) \u2014 LIVE requires confirm
   - Stop bot
   - Restart bot
   - Kill switch (big red button, confirm + typed keyword)
   - Pause trading (soft flag, bot keeps reading but skips orders)

2. **Test scripts panel:**
   - Clickable list of known test scripts from [src/scripts/](src/scripts/):
     - `test_connection` \u2014 read-only Hyperliquid smoke
     - `test_dry_run` \u2014 one-shot pipeline
     - `test_micro_trade` \u2014 $20 round-trip (confirm, real money)
     - `test_stop_loss` \u2014 stop + cancel + close (confirm)
   - Output streams into a collapsible terminal panel
   - Last run time + last exit code shown per script

3. **Scheduled tasks (optional, phase 2):**
   - Daily health check at 09:00
   - Weekly P&L report to Discord
   - Auto-launch TradingView on system boot

4. **Environment status strip:**
   - TradingView CDP port 9222 \u2014 open / closed
   - Bot process \u2014 alive / dead + uptime
   - Supabase connection \u2014 healthy
   - Hyperliquid API \u2014 reachable
   - Last DRY_RUN tick \u2014 timestamp

**All of these go through the `bot_commands` table.** The bot is the
only thing executing PowerShell \u2014 Vercel never does.

---

### 3.5 Logs (`/logs`)

Live streaming console of the bot's stdout and structured events.

**Sections:**

1. **Stream view:**
   - Monospace log lines, newest at bottom (or top, toggle)
   - Auto-scroll toggle
   - Level filter: TRACE / DEBUG / INFO / WARN / ERROR
   - Source filter: main / mcp / hyperliquid / strategy / risk
   - Text search (highlight matches)
   - Time range picker

2. **Event timeline** (structured events, parallel to stream):
   - Tick completed
   - Signal fired
   - Order placed / filled / cancelled
   - Stop hit
   - Risk limit hit
   - MCP reconnect

**How logs get here:**
- Bot has a Supabase log sink that batches and inserts every N lines
  (e.g. 50 lines or 2 seconds) into `bot_logs` table
- Table has TTL policy (delete rows older than 7 days)
- Frontend uses Realtime subscription for tail mode, or paginated query
  for history

---

### 3.6 Navigation & Shell

- Top bar: logo, nav (Dashboard \u2022 Trades \u2022 Strategies \u2022 Automation \u2022 Logs)
- Right side of top bar: bot status badge, light/dark toggle, user menu
- Persistent "kill switch" floating button (bottom-right) on every page
  when bot is LIVE \u2014 one click away from halting everything

---

## 4. Data Model (Supabase)

All tables live in the `public` schema. Row-Level Security enabled,
policy: single authenticated user (you) can read/write everything.

```sql
-- Strategy templates (seed, 1 row per TS file)
create table strategy_templates (
  id                text primary key,              -- 's1', 's2', 's3'
  name              text not null,                 -- 'EMA Trend'
  description       text,
  param_schema      jsonb not null,                -- JSON schema for params
  created_at        timestamptz default now()
);

-- User-created parameter variants of a template
create table strategy_configs (
  id                uuid primary key default gen_random_uuid(),
  template_id       text references strategy_templates(id),
  name              text not null,
  params            jsonb not null,
  enabled           boolean default false,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- Market snapshot at each bot tick
create table market_snapshots (
  id                bigserial primary key,
  taken_at          timestamptz default now(),
  symbol            text default 'BTC',
  price             numeric,
  funding_rate      numeric,
  timeframes        jsonb,                         -- { '15m': {...}, '1h': {...}, ... }
  macro_filter      text,                          -- 'bullish' | 'bearish' | 'neutral'
  confluence_score  int
);
create index on market_snapshots (taken_at desc);

-- Hyperliquid positions (synced snapshot)
create table positions (
  id                uuid primary key default gen_random_uuid(),
  hl_position_id    text unique,
  symbol            text,
  side              text check (side in ('long', 'short')),
  size              numeric,
  entry_price       numeric,
  mark_price        numeric,
  unrealized_pnl    numeric,
  liquidation_price numeric,
  leverage          numeric,
  strategy_config_id uuid references strategy_configs(id),
  opened_at         timestamptz,
  synced_at         timestamptz default now()
);

-- Closed trades
create table trades (
  id                uuid primary key default gen_random_uuid(),
  strategy_config_id uuid references strategy_configs(id),
  symbol            text,
  side              text,
  size              numeric,
  entry_price       numeric,
  exit_price        numeric,
  entry_time        timestamptz,
  exit_time         timestamptz,
  pnl_usd           numeric,
  pnl_r             numeric,                       -- in R units
  fees_usd          numeric,
  slippage_bps      numeric,
  exit_reason       text,                          -- 'stop', 'target', 'manual', 'eod'
  entry_conditions  jsonb,                         -- what fired the entry
  created_at        timestamptz default now()
);

-- Journal entries (notes + screenshots)
create table journal_entries (
  id                uuid primary key default gen_random_uuid(),
  trade_id          uuid references trades(id) on delete cascade,
  note              text,
  screenshot_url    text,                          -- Supabase storage bucket
  tags              text[],
  created_at        timestamptz default now()
);

-- Risk snapshot over time
create table risk_snapshots (
  id                bigserial primary key,
  taken_at          timestamptz default now(),
  bankroll_usd      numeric,
  daily_pnl         numeric,
  weekly_pnl        numeric,
  daily_dd_pct      numeric,
  weekly_dd_pct     numeric,
  consecutive_losses int,
  open_position_count int,
  paused_until      timestamptz,
  pause_reason      text
);

-- Commands from frontend to bot
create table bot_commands (
  id                uuid primary key default gen_random_uuid(),
  type              text not null,                 -- see command types
  payload           jsonb,
  status            text default 'pending',        -- pending | running | done | failed
  result            jsonb,
  error             text,
  issued_at         timestamptz default now(),
  started_at        timestamptz,
  finished_at       timestamptz
);
create index on bot_commands (status, issued_at);

-- Log lines
create table bot_logs (
  id                bigserial primary key,
  ts                timestamptz default now(),
  level             text,                          -- trace | debug | info | warn | error
  source            text,                          -- main | mcp | hl | strategy | risk
  message           text,
  context           jsonb
);
create index on bot_logs (ts desc);

-- Alert channel configs
create table alert_configs (
  id                uuid primary key default gen_random_uuid(),
  channel           text,                          -- 'discord' | 'telegram' | 'email'
  webhook_url       text,                          -- encrypted via Supabase Vault
  events            text[],                        -- ['trade_opened', 'stop_hit', 'dd_limit']
  enabled           boolean default true
);

-- Backtest runs
create table backtest_runs (
  id                uuid primary key default gen_random_uuid(),
  strategy_config_id uuid references strategy_configs(id),
  from_date         date,
  to_date           date,
  status            text default 'queued',
  metrics           jsonb,                         -- sharpe, max_dd, win_rate, trades, etc.
  equity_curve      jsonb,                         -- [{t, equity}, ...]
  created_at        timestamptz default now()
);
```

### Realtime channels

- `market_snapshots` inserts \u2192 Dashboard live update
- `positions` updates \u2192 Dashboard + Trades live update
- `risk_snapshots` inserts \u2192 Dashboard risk strip
- `bot_commands` updates \u2192 Frontend confirmation of command completion
- `bot_logs` inserts \u2192 Logs page tail mode
- `trades` inserts \u2192 Trades page + alert fanout

---

## 5. Bot-side changes needed

The bot currently has no frontend hooks. We need:

| Change | File (new or edit) | Effort |
|--------|-------------------|--------|
| Add `@supabase/supabase-js` client | `src/db/supabase.ts` (new) | S |
| Write `market_snapshots` each tick | `src/main.ts` (edit) | S |
| Write `risk_snapshots` each tick | `src/main.ts` (edit) | S |
| Write `trades` on entry/exit | `src/hyperliquid/orders.ts` or new trade tracker | M |
| Sync `positions` table from Hyperliquid | `src/main.ts` (edit) | S |
| Load `strategy_configs` on startup | `src/strategy/loader.ts` (new) | M |
| Subscribe to `bot_commands` (realtime) | `src/bot_commands/listener.ts` (new) | M |
| PowerShell command executor (whitelisted) | `src/bot_commands/powershell.ts` (new) | M |
| Log sink \u2192 `bot_logs` table (batched) | `src/logger/supabase_sink.ts` (new) | M |
| Backtest runner (phase 2) | `src/backtest/` (new) | L |
| Alert fanout to Discord/Telegram | `src/alerts/` (new) | M |

**Critical safety constraint:** the PowerShell executor must have a
**hard-coded whitelist** of allowed commands. It must never execute
arbitrary shell strings from the database. Examples of whitelist entries:

```ts
const ALLOWED_COMMANDS = {
  launch_tradingview: 'powershell.exe -File launch_tradingview.ps1',
  start_bot_dryrun: 'powershell.exe -Command "$env:DRY_RUN=\\"true\\"; npm start"',
  stop_bot: null,         // handled in-process, not via shell
  run_test_connection: 'npx tsx src/scripts/test_connection.ts',
  // ...
} as const;
```

---

## 6. Feature inventory (all pages)

| Page | Feature | Phase |
|------|---------|-------|
| Dashboard | Hero KPIs | 1 |
| Dashboard | Multi-TF confluence matrix | 1 |
| Dashboard | Open positions + quick close | 1 |
| Dashboard | BTC candlestick chart with overlays | 2 |
| Dashboard | Risk status strip | 1 |
| Dashboard | Signal preview for all strategies | 2 |
| Trades | Equity curve | 1 |
| Trades | Trade list + filters | 1 |
| Trades | Per-strategy metrics | 1 |
| Trades | Trade detail drawer | 2 |
| Trades | Journal notes + screenshots | 2 |
| Strategies | List + enable toggles | 1 |
| Strategies | Parameter edit form | 1 |
| Strategies | Duplicate variant | 1 |
| Strategies | Performance tab per variant | 2 |
| Strategies | Param version history | 3 |
| Automation | Launch TV / start / stop | 1 |
| Automation | Kill switch | 1 |
| Automation | Test script runners | 2 |
| Automation | Scheduled tasks | 3 |
| Logs | Live tail | 1 |
| Logs | Level + source filter | 1 |
| Logs | Structured event timeline | 2 |
| Global | Light/dark toggle | 1 |
| Global | Auth (magic link) | 1 |
| Global | Alert channel setup (Discord/Telegram) | 2 |
| Global | Backtest page | 3 |

---

## 7. Design notes

These are the **constraints** for the UI/UX Max Pro and Anthropic
design skill pass — not final designs. The design skills will produce
the actual component specs, color tokens, and layout grids.

- **Visual tone:** clean, professional, trading-desk aesthetic. Data
  density favored over whitespace on Dashboard and Trades. Strategy and
  Automation pages can breathe more.
- **Theme:** light and dark, switched via toggle. Both themes are
  first-class \u2014 no "dark mode is an afterthought".
- **Color semantics:** green = long / profit, red = short / loss, amber
  = warning / paused. Use a neutral accent (not green/red) for primary
  actions to avoid confusion.
- **Typography:** monospace (JetBrains Mono or IBM Plex Mono) for all
  numeric columns; sans-serif (Inter) for headings and body.
- **Motion:** subtle. Realtime updates should flash briefly on the
  changed cell, not re-render the whole table.
- **Accessibility:** keyboard shortcuts for common actions (e.g. `g d`
  for Dashboard, `g t` for Trades, `k` for kill switch with typed
  confirm).
- **Mobile:** responsive, but optimized for desktop. The kill switch
  and bot status must work on mobile for emergency halts.

---

## 8. Phased implementation plan

**Phase 1 \u2014 Read-only core (minimum usable)**
1. Supabase project + schema + seed strategy templates
2. Bot writes `market_snapshots`, `positions`, `trades`, `risk_snapshots`
3. Next.js scaffold + shadcn/ui + light/dark + auth
4. Dashboard page (KPIs, confluence matrix, positions, risk strip)
5. Trades page (list, equity curve, per-strategy metrics)
6. Logs page (live tail + filters)
7. Deploy to Vercel

**Phase 2 \u2014 Control surface**
1. `bot_commands` table + bot listener + PS executor (whitelisted)
2. Automation page (launch TV, start/stop, kill switch, test scripts)
3. Strategies page (list, edit params, duplicate)
4. Candlestick chart on Dashboard with overlays
5. Trade detail drawer + journal notes
6. Alerts configuration + Discord/Telegram sink

**Phase 3 \u2014 Advanced**
1. Backtesting page (historical candles, equity curve, metrics)
2. Scheduled tasks panel
3. Param version history and rollback
4. Mobile-optimized emergency view

---

## 9. Open risks & things to decide later

| Topic | Decision needed |
|-------|-----------------|
| Supabase tier | Free tier ok for phase 1? Need to estimate row rate for `market_snapshots` and `bot_logs`. A 15-min loop \u2192 96 snapshots/day \u2192 fine. Log volume is the risk \u2014 keep batching + TTL. |
| Storage for screenshots | Supabase Storage bucket. Need policy + size limits. |
| Realtime vs polling | Supabase Realtime is great but has connection limits. Prefer realtime for the 5 critical tables; fall back to 5s polling for everything else. |
| Deploy target for Next.js | Vercel is locked in, but we'll need Vercel env vars for Supabase URL + anon key. Service role key lives only in the bot. |
| Bot single-instance guarantee | If the command listener runs in a second bot process, you'll get double execution. Add a heartbeat lock in a `bot_instances` table. |
| LIVE-mode gating | The "Start bot (LIVE)" button should be disabled unless a user-settable "live mode armed" flag is true in DB, which auto-disarms after N minutes. Prevents accidental LIVE starts. |

---

## 10. Recommended next steps

1. **Confirm this analysis is on track** \u2014 read-through, flag anything
   missing or that should be cut.
2. **Provision Supabase project** \u2014 create project, note URL + anon
   key + service role key. Install Supabase MCP so I can manage schema
   directly.
3. **Apply Phase 1 schema** \u2014 I'll generate `supabase/migrations/*.sql`
   files and walk you through `supabase db push`.
4. **Add Supabase client to bot** \u2014 minimal change, DRY_RUN writes
   start flowing to `market_snapshots` so we can verify the pipe.
5. **Scaffold Next.js app** in `frontend/` subdirectory.
6. **Invoke UI/UX Max Pro + Anthropic design skill** to produce the
   design system (colors, typography, component library tokens,
   light/dark palette) before building pages.
7. **Build Dashboard first** \u2014 it's the most useful and exercises the
   whole data pipeline end-to-end.

---

*End of analysis. Awaiting review before implementation starts.*
