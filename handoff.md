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

## What Was Done (Session 48) — P0 again: WS loop dead 54 days (S44 fix had one hole) — recovered, hardened, made visible

*(Session 47 was hooks-only: `d772f58` Bash-level secret-exfil guards + native deny list, `95295f3` CLAUDE.md refresh. No bot changes.)*

### Deep dive: bot silently dead since 2026-06-27 08:34 UTC (2 days after the S46 restart)
pm2: online, 55D uptime, ↺=43 (unchanged since S46) — looked healthy. Log file: only webhook lines, zero `Bar close`, error log empty since Jun 29. All pm2 log history before Aug 17 destroyed by `pm2-logrotate retain=3`; forensics reconstructed from Supabase `bot_logs`:
- `08:30:00` last good bar close → `08:34:08` `[WS] No message in 68s — reconnect attempt 1/10` (Hyperliquid 502) → teardown took exactly 20s (S44 timeouts *worked*) → gap-fill 502 → `08:34:28` `[WS] Connecting to Hyperliquid WebSocket...` → **silence for 54 days.** No attempt 2/10, no timeout error, no `process.exit`.
- Collateral: Supabase Realtime command channel `closed` on Jun 28 and never resubscribed — frontend kill switch was dead too.
- The 2h Status Digest posted `Status: ACTIVE` to Discord the entire time (it had no bar-close info).

**Root cause:** [candle-consumer.ts:178](src/ws/candle-consumer.ts#L178) — the *error-path* `await transport[Symbol.asyncDispose]()` inside `subscribe()` was the one network await S44 did not wrap in `withTimeout`. Subscribe timed out → catch → dispose of a half-open socket hung forever → `subscribe()` never threw → `reconnect()` never reached `finally` → `reconnecting` pinned `true` → heartbeat silently returned forever. Identical deadlock class to S44, one level deeper.

### Fixes (`dbbe9c6`, deployed + verified live)
1. **Guarded the error-path dispose** with `withTimeout` (the direct bug).
2. **Reconnect watchdog** — heartbeat tracks `reconnectingSince`; if `reconnecting` has been true > 3 min, `process.exit(1)` → pm2 restart → clean warmup. `setInterval` keeps firing even when a prior callback's await never settles, so no future hang anywhere in the (re)connect path can silence it. Ends the whack-a-mole class.
3. **Hydration SL/TP classification by order type** — `TriggerOrderInfo.isStopLoss` from `frontendOpenOrders().orderType` (`"Stop Market"` vs `"Take Profit Market"`), replacing trigger-price-vs-entry in [main-headless.ts](src/main-headless.ts). A stop trailed into profit now hydrates as the SL and keeps trailing (S46 Watchlist row 3 closed).
4. **Command channel auto-resubscribe** on `CLOSED` (30s backoff, `_stopped` guard so SIGTERM shutdown doesn't loop).

Restart: warmup clean, WS subscribed, live `[WS] Bar closed` confirmed against the exchange clock. ~19h later still current.

### Visibility layer (`44baa34`) — never again blind
- **`deploy/deadman-check.cjs`** — cron on the VPS (every 15 min, *outside* pm2/the bot process) reads the newest `[WS] Bar closed` row from Supabase `bot_logs`; >35 min old → Discord `#errors` alert, re-alert every 2h, recovery notice. State file `~/.tradekit-deadman.json`. Log: `~/.pm2/logs/deadman.log`. Tested end-to-end (forced alert + recovery posted).
- **Status digest** now leads with `Last bar close: Nmin ago` and mirrors a red alert to `#errors` when >30 min.
- **`pm2-logrotate retain` 3 → 30** so the next forensics don't depend on Supabase.

### VPS is now a clean git checkout
Deploys were scp-over-`bb3171e` (git log lied about the running version). Converted: backed up live `trades/trade_log.json` (667 lines; upstream stub is 1 line) to `~/trade_log.backup.20260820-195526.json`, `git checkout -- src/`, `git pull --ff-only` → `44baa34`, restored ledger byte-identical, `git update-index --skip-worktree trades/trade_log.json`. Content diff before conversion confirmed the running files matched the commits exactly. **Future deploys: `git pull` on the box, then `pm2 restart trading-bot`.**

### Money
- S1 SHORT closed **2026-07-01** via the S46 manual $61,050 stop (oid `479697922460`), filled $61,220 → **+$4.27 realized**. Last fill on the account.
- Flat since. Account value **$381.56**, all withdrawable; reconciles to the cent with prior ledger. Zero $ lost to the outage — but every S1/S6 signal Jun 27 → Aug 20 was skipped while BTC moved ~$62k → ~$69k.

---

## What Was Done (Session 50) — Polish audit + Sprint 1 shipped (market-data fix, strategy instrument)

*(Session 49 was docs-only: `977a9aa` Rein x TradeKit assessment. This machine was 84 commits behind and was fast-forwarded first.)*

- **`/polish scan` audit written:** `docs/polish/tradekit-polish-audit.md` — 16 items, 5 sprints, none Risk-H. Root causes: (A1) market-data page crashed on `.toFixed(null)` because the bot warms up 250 daily bars but 1D PMARP/BBWP need 350/252, NaN -> null in Supabase JSON; (A2) the -$25.74 / 29% headline sums the dead S3/S2 eras with the live S1+S6 set and there was no per-strategy instrument; (G3) every backtest is in-sample — no walk-forward split exists.
- **Sprint 1 shipped + pushed (`4647567`, frontend only, bot untouched):** null-safe market-data page; trades page with date column, strategy column, per-strategy scoreboard (live vs backtest reference, red when >= 10 trades and 10 pts under), default window "since current config" 2026-06-01 with All-time toggle; strategies page joined on `entry_conditions.strategy`, S6 card (in-page fallback, DB row optional — SQL in the record), LIVE/DISABLED badges. Verified: tsc, eslint, `next build` all 0. Record: `docs/polish/tradekit-polish.md`.
- **Owner rules recorded:** push after every sprint; list blockers before the next phase.
- **Not done / not touched:** no VPS liveness check this session (Watchlist rows 1-2 still due); Supabase MCP unauthorised (row shapes inferred from `src/db/*.ts`); no browser smoke (pages behind login).

### Sprint 2 blockers (out-of-sample backtests G3 + G5)
1. **No Binance CSVs on this machine** — `data/` is empty; `backtest_binance.ts` expects `./data/bt-data/BTCUSDT-15m-*.csv`. Run `npx ts-node src/scripts/download_binance.ts --months=30` first (~2-3 MB; needs the range to reach Sept 2026 for a real test window).
2. **Sprint 1 human verdict pending** — checklist in `docs/polish/tradekit-polish.md`; the audit's status table row says "pending".
3. **Train/test cut date is an owner call** — proposed: train = 2024-03 -> 2025-06 (parameters may be tuned here), test = 2025-07 -> latest (report only). S6 lookback=40 and the S1 filters were all chosen on the full window, so expect the test-window numbers to be worse than the archive's +33%.
4. **Bot-side items (F1 stop retry, F2 1D warmup, F3 digest leverage) stay parked** until the first post-outage trade validates the S48 fixes (Watchlist row 2).

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-08-20 | **WS bar-close loop liveness** (S44: 7d dead, S48: 54d dead) — **checked S51 2026-09-17: ALIVE**, newest bar close 0 min old. No ssh key on this laptop, so use `npx ts-node src/scripts/check_ws_liveness.ts` (ssh-free, reads the same Supabase signal as the dead-man cron). | pm2 "online" does NOT mean the bar-close loop is alive — the S5 webhook masks a dead WS. `pm2 logs --nostream` LIES (stale buffer) — read the log FILE. Don't trust the local machine clock (35h off in S46) — use the exchange clock. **Now guarded 3 ways (S48):** reconnect watchdog (`dbbe9c6`, 3 min stuck → `process.exit` → pm2 restart, ↺ counter climbs), digest shows `Last bar close: Nmin ago`, and the external dead-man cron posts to Discord `#errors` if >35 min stale. **If Discord is quiet, it still means check** — the dead-man itself is new and unproven on a real outage. | Liveness: `ssh … "tail -5 ~/.pm2/logs/trading-bot-out.log"` — newest `Bar close` within ~15 min. Dead-man health: `ssh … "tail -3 ~/.pm2/logs/deadman.log"` (should say `ok` every 15 min). Exchange clock: `curl -s -X POST https://api.hyperliquid.xyz/info -H 'Content-Type: application/json' -d '{"type":"candleSnapshot","req":{"coin":"BTC","interval":"15m","startTime":1750000000000,"endTime":1800000000000}}'` → last candle `T` = real time. If ↺ > 45, a watchdog/self-heal restart fired — read the error log for why. |
| 2026-08-20 | **First trade after the outage** — **S51: PARTLY CLOSED.** The bot resumed trading in late Aug (trades through Sep 15), so this row's premise "no position since Jul 1" was stale. (a) S46 oid capture **VALIDATED** — 4 ratcheting modifies on 2026-09-14, Y≠X every time, zero `Failed to modify` since 2026-06-25. (b) Hydration with an open profitable position **still unexercised** (last restart 2026-08-20 logged `No open positions to hydrate`). (c) command channel unchecked. | No position since Jul 1. The next entry exercises: (a) `aa15560` oid capture — expect `[Orders] Stop-loss modified: oid=X → Y` with Y ≠ X and NO `Failed to modify SL`; (b) if the bot restarts while that position is in profit, hydration must log it as `SL=$…` (not `1 TP(s)`) and trailing must continue; (c) command channel still `active` (kill switch reachable). | `ssh … "grep -a -E 'Stop-loss modified|Failed to modify|hydrat' ~/.pm2/logs/trading-bot-out.log \| tail -20"` |
| 2026-05-06 | S5 cascade pipe LIVE | Receiving `medium` heartbeats hourly (still the only severity ever seen). Monitor for first `high`. | `ssh … "grep -a -i cascade ~/.pm2/logs/trading-bot-out.log \| grep -v medium \| tail"` |
| 2026-08-20 | Balance | Account value **$381.56**, flat, all withdrawable (S1 SHORT +$4.27 on Jul 1 folded in). Bot bankroll hydrates from trade log — check the startup `Bankroll:` line matches ±funding. | `ssh … "grep -a Balance ~/.pm2/logs/trading-bot-out.log \| tail -2"` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Reconnect GitHub to the Vercel `trade-kit` project** | low | **S51 finding: Vercel has NO Git auto-deploy** — `vercel project inspect` shows no connected repo and every deployment is a manual CLI deploy. Sprint 1 (`4647567`) is on GitHub `main` but the live site served a 27-day-old build, so all three S50 fixes were invisible. Owner is doing this in the Vercel dashboard (Settings > Git > Connect `bugiiiii11/TradeKit`, keep Root Directory `frontend`). Connecting does not rebuild HEAD by itself — follow with `git commit --allow-empty -m "chore: trigger vercel deploy" && git push`. |
| 1b | **Verify Sprint 1 once the deploy lands** | low | Checklist in `docs/polish/tradekit-polish.md` (market-data loads; trades scoreboard + since/all-time toggle; strategies S6 card). Then mark the audit status row verified. Optional: run the S6 `strategy_templates` insert SQL from the record. |
| 2 | **Sprint 2 = out-of-sample truth (G3 + G5)** | low | Blockers listed in the S50 section: download Binance CSVs (`download_binance.ts --months=30`), agree the train/test cut. Then `/polish run 2`. Backtests only, no live change. Decides whether S1+S6 has an edge before any new strategy is built. |
| 3 | **Leave the bot alone and let it trade** | low | Back online 2026-08-20 after 54 days dead. It needs uninterrupted bar closes to generate the next entry, which is the validation event for four fixes (Watchlist row 2). Avoid restarts unless something is actually wrong. |
| 4 | **Verify the dead-man cron is still running each session** | low | `tail ~/.pm2/logs/deadman.log` should show an `ok` line every 15 min. If the log stops, the cron died (or node/env changed) — that's a silent loss of the safety net. |
| 5 | **Leverage decision (still 1.0x)** | low | 4 closed bot trades: S43 S6 SHORT +$19.93/6.95R, S6 LONG +$2.67/4.41R, S6 SHORT −$3.16, S1 SHORT +$4.27. Still too few. Revisit at ~10. |
| 6 | **Meta Signals summary → Martin** | low | S38: no API/webhook, Discord-only. Recommend manual trade dashboard. Ask about $179/mo subscription. |
| 7 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (S28). Hydration (S32 trade-log match + S48 order-type SL/TP) protects web UI trades. |
| 8 | **S2 / S3 / S7 re-evaluation** | low | All parked. Revisit only on logic rework. |
| 9 | **Optional: stop tracking `trades/trade_log.json` in git** | low | It's live per-bot data (VPS 667 lines vs repo stub). Currently `skip-worktree` on the VPS. Cleaner: `.gitignore` it + keep a committed `trade_log.example.json`. Not urgent. |
