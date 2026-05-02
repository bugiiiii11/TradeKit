# TradeKit — Session Archive

> Historical session notes (Sessions 1-16, 23). Moved from handoff.md to keep it lean.
> For current work, see handoff.md. For project context, see CLAUDE.md.

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

## What Was Done (Session 16) — Backtesting engine (Hyperliquid API + strategy replay)

1. **Manual trade card confirmed end-to-end** — user submitted a real trade from the Vercel dashboard. BTC long (15x) opened on Hyperliquid with SL < 73,800 and 3 TP orders (75,800 / 77,850 / 80,500) confirmed on Open Orders. Marks task #32 complete.

2. **Backtesting engine built** — 7 new files, typecheck clean, committed `dd5542d` and pushed to GitHub. Data source changed from TradingView MCP (single-bar only) to **Hyperliquid public candle API** (months of OHLCV, no auth required).

   **Architecture:**
   - `src/backtest/collector.ts` — fetches BTC candles from `api.hyperliquid.xyz/info` (`candleSnapshot`), all 4 TFs in parallel, paginated, per-TF warmup (270 days extra for 1D indicators)
   - `src/backtest/indicators.ts` — EMA (SMA-seeded), RSI (Wilder's), StochRSI, BBWP (period=13, lookback=252), PMARP (SMA-50, lookback=200)
   - `src/backtest/aligner.ts` — binary-search alignment of 1H/4H/1D to each 15m bar
   - `src/backtest/engine.ts` — replay loop: reuses `evaluateS1/S2/S3` + `scoreSignals` for entries (macro filter applied); exit logic re-implemented inline to avoid module-state ordering issues; 0.035% taker fee per side deducted; one position at a time (v1 simplification)
   - `src/backtest/reporter.ts` — per-strategy table + risk metrics + last 15 trades; saves `backtest-results.json`
   - `src/scripts/backtest.ts` — CLI with `--days`, `--bankroll`, `--margin` flags

   **Known v1 simplifications:** close-only SL/TP detection uses bar high/low (not tick data); S3 TPs exit full position at highest TP reached in bar (not 33/33/34% partial closes); BBWP/PMARP use default TV params (may differ if chart settings differ).

---

## Session 23 — Fix consecutive-loss infinite pause + dead WebSocket

**Two bugs found and fixed, both deployed to VPS.**

### Bug 1: Consecutive Loss Infinite Pause Loop
Risk manager `canTrade()` checked `consecutiveLosses >= 3` on every call — but the counter only resets on a winning trade. After 4 S3 losses, the bot was permanently stuck: pause 4h -> expire -> signal arrives -> re-pause 4h -> repeat forever.

**Fix:** Reset `consecutiveLosses` to 0 when the pause is triggered (`resetConsecutiveLosses()` in `state.ts`, called from `manager.ts`). After the 4h cool-off, bot gets a fresh slate.

### Bug 2: WebSocket Dead for 48 Hours
Heartbeat detected staleness but `reconnect()` silently failed every 30 seconds for 48 hours (5,700+ attempts).

**Fix:** Added `MAX_RECONNECT_ATTEMPTS = 10` to `candle-consumer.ts`. After 10 consecutive failed reconnects (~5 min), process exits with code 1 for pm2 to do a clean restart. Counter resets to 0 on any successful message.

### Other
- Consultant review of Session 22 trades: 8 trades, 6 S3, 33% WR, 4.54x R:R
- Analyzed Flash `regimeFilter.ts` for potential S3 improvement
- Committed `9677532`, deployed to VPS.
