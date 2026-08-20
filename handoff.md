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

## What Was Done (Session 46) — Trailing-stale bug fixed + deployed, manual profit floor

### Deep dive caught the trailing-stale bug firing LIVE (Watchlist row 3 triggered)
Two red herrings nearly derailed the health check, worth recording:
1. **Local Windows clock was ~35h behind real time** — comparing the bot against it first showed a false "PASS", then a false "35h-dead-loop P0". The exchange is the only reliable clock: queried Hyperliquid's latest 15m candle → confirmed real time + that the **WS loop was actually alive and current** (contiguous bars Jun 22→25, no gap).
2. **`pm2 logs --nostream` serves stale buffered lines** — it reported the newest bar as 35h old while the actual log *file* (`tail`) was current. **Read the log file directly, not via `pm2 logs --nostream`, for liveness.** The Watchlist row-1 command uses `--nostream`, so that watch can lie — updated below.

Real finding: `[Trailing] Failed to modify SL for S1: Cannot modify canceled or filled order` firing **every bar, 88× in the current error log**, and mirrored to Discord every 15 min. Trailing was non-functional on the open S1 SHORT; its stop was frozen at $63,249 (above entry → protected nothing on a now-profitable short).

### Root cause + fix B (committed `aa15560`, deployed to VPS)
Hyperliquid **reassigns an order's oid on every `modify`**. `modifyStopLoss` used single `modify()` (which does *not* echo the new oid) and returned the *input* oid, so after the FIRST successful trail the bot tracked a dead oid forever. Same bug hit the S6 LONG in S45.
- `orders.ts`: `modifyStopLoss` now uses **`batchModify`** (echoes new oid), returns it, and **self-heals** — if the tracked oid is stale it re-discovers the live reduce-only BTC stop and retries once (also covers restart-hydration staleness).
- `main-headless.ts:665`: caller now persists the returned oid into `pos.stopOid`.
- Type-checks clean. Restarted VPS bot (↺=43): position hydrated, WS subscribed, bar closes current. `batchModify` confirmed on box.

### Manual profit floor (option A) — `move_s1_sl.ts`
While the bot was still on old code, manually re-trailed the stuck S1 SHORT stop **$63,249 → $61,050** via a new one-off script (dry-run by default, hard-guarded to the VPS wallet, finds the live stop by querying the book). Locks ~+$4.78 profit (entry $62,637; BTC had fallen to ~$59,500, uPnL ~+$8.5). Atomic `modify`, position never naked. Stop oid now `479697922460`.

### New latent bug found — hydration misclassifies a trailed-into-profit stop as a TP
Hydration (`main-headless.ts:122`) classifies SL vs TP purely by trigger-price-vs-entry. The $61,050 stop is *below* entry (short trailed into profit), so on the post-fix restart the bot logged it as `SL=$62888 (estimated), 1 TP(s)` — `stopOid` undefined → **trailing skipped on this position** (harmless side effect: the Discord spam stops). Money is safe (the $61,050 order is a real SL trigger on the exchange regardless of the bot's label). Proper fix: classify by the order's `tpsl` field, not price. Added to Watchlist + Untested Code Paths.

### Net state
S1 SHORT rides a static $61,050 profit floor until it closes via strategy exit or stop. B works correctly for all *future* positions (normal above-entry stops hydrate + trail + capture oid). Account value ~$386, bankroll $358.47.

---

## What Was Done (Session 45) — Health check + position reconciliation + post-trade forensics

### WS liveness — S44 fix holding (Watchlist row 1, PASS)
Bar-close loop **live and current** (last bar within ~2–7 min of check across the session). S6-diag logging every bar (BBWP cooled 98→87 over the session, EMA21=below/short). pm2 `trading-bot` online, 2D uptime (S44 patch restart), ↺=42. No real WS outage occurred, so the timeout-guard self-heal path still hasn't been exercised live — keep watching.

### Open position reconciled — handoff was stale
Handoff tracked an S6 LONG @ $62,191; Hyperliquid ground truth showed it **closed**, replaced by a new **S1 SHORT** -0.00301 BTC @ $62,637 (10x isolated, opened 2026-06-23 08:15Z). Confirmed S1 via clearinghouse 10x + `[Trailing] S1 short` log. uPnL drifted +$0.28 → +$0.67 over the session as BTC fell to ~$62,413. Trailing SL holding at $63,249 (ratchet-only, ~1% above entry — not yet locked-profit). Account value $377.5–377.9, bankroll $358.47.

### Post-trade forensics (corrected ledger from Supabase `trades`)
Raw fills misled an initial read; Supabase trade records are authoritative:
- **S6 LONG** (Jun 10→21, 11d): 62191 → 63289, **+$2.67 / 4.41R**, exit `ema_reverse_cross` (strategy exit, *not* trailing SL). Survived the 7-day dead loop on a frozen static stop.
- **S6 SHORT** (Jun 21→22, 1.7h): 63289 → 64680, **−$3.16 / −1.10R**, exit `native_sl`. Entirely between sessions, unlogged in S44.
- **Net realized since S44: −$0.49.**

### New reliability finding — trailing SL goes stale after restart/outage
Forensics surfaced `[Trailing] Failed to modify SL: Cannot modify canceled or filled order` repeating every 15 min Jun 20 19:00–22:15. After the outage the S6 LONG's SL order ref was stale, so trailing was **non-functional on that position** until it exited. **Failed safely** (try/catch, no crash; `ema_reverse_cross` caught it at +$2.67), but a post-restart position can silently lose trailing protection. Added as Tier-0 watch. This is the known "modifyStopLoss failure" untested path manifesting live.

### Docs
Watchlist row 2 rewritten (S6 LONG → S1 SHORT), balance row updated, new trailing-stale watch added. Stray `bash.exe.stackdump` removed. Commits `cb8c590` (this session) pushed to main.

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-08-20 | **WS bar-close loop liveness** (S44: 7d dead, S48: 54d dead) | pm2 "online" does NOT mean the bar-close loop is alive — the S5 webhook masks a dead WS. `pm2 logs --nostream` LIES (stale buffer) — read the log FILE. Don't trust the local machine clock (35h off in S46) — use the exchange clock. **Now guarded 3 ways (S48):** reconnect watchdog (`dbbe9c6`, 3 min stuck → `process.exit` → pm2 restart, ↺ counter climbs), digest shows `Last bar close: Nmin ago`, and the external dead-man cron posts to Discord `#errors` if >35 min stale. **If Discord is quiet, it still means check** — the dead-man itself is new and unproven on a real outage. | Liveness: `ssh … "tail -5 ~/.pm2/logs/trading-bot-out.log"` — newest `Bar close` within ~15 min. Dead-man health: `ssh … "tail -3 ~/.pm2/logs/deadman.log"` (should say `ok` every 15 min). Exchange clock: `curl -s -X POST https://api.hyperliquid.xyz/info -H 'Content-Type: application/json' -d '{"type":"candleSnapshot","req":{"coin":"BTC","interval":"15m","startTime":1750000000000,"endTime":1800000000000}}'` → last candle `T` = real time. If ↺ > 45, a watchdog/self-heal restart fired — read the error log for why. |
| 2026-08-20 | **First trade after the outage** — three S48 fixes + the S46 oid fix all prove out on it | No position since Jul 1. The next entry exercises: (a) `aa15560` oid capture — expect `[Orders] Stop-loss modified: oid=X → Y` with Y ≠ X and NO `Failed to modify SL`; (b) if the bot restarts while that position is in profit, hydration must log it as `SL=$…` (not `1 TP(s)`) and trailing must continue; (c) command channel still `active` (kill switch reachable). | `ssh … "grep -a -E 'Stop-loss modified|Failed to modify|hydrat' ~/.pm2/logs/trading-bot-out.log \| tail -20"` |
| 2026-05-06 | S5 cascade pipe LIVE | Receiving `medium` heartbeats hourly (still the only severity ever seen). Monitor for first `high`. | `ssh … "grep -a -i cascade ~/.pm2/logs/trading-bot-out.log \| grep -v medium \| tail"` |
| 2026-08-20 | Balance | Account value **$381.56**, flat, all withdrawable (S1 SHORT +$4.27 on Jul 1 folded in). Bot bankroll hydrates from trade log — check the startup `Bankroll:` line matches ±funding. | `ssh … "grep -a Balance ~/.pm2/logs/trading-bot-out.log \| tail -2"` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Leave the bot alone and let it trade** | low | Back online 2026-08-20 after 54 days dead. It needs uninterrupted bar closes to generate the next entry, which is the validation event for four fixes (Watchlist row 2). Avoid restarts unless something is actually wrong. |
| 2 | **Verify the dead-man cron is still running each session** | low | `tail ~/.pm2/logs/deadman.log` should show an `ok` line every 15 min. If the log stops, the cron died (or node/env changed) — that's a silent loss of the safety net. |
| 3 | **Leverage decision (still 1.0x)** | low | 4 closed bot trades: S43 S6 SHORT +$19.93/6.95R, S6 LONG +$2.67/4.41R, S6 SHORT −$3.16, S1 SHORT +$4.27. Still too few. Revisit at ~10. |
| 4 | **Meta Signals summary → Martin** | low | S38: no API/webhook, Discord-only. Recommend manual trade dashboard. Ask about $179/mo subscription. |
| 5 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (S28). Hydration (S32 trade-log match + S48 order-type SL/TP) protects web UI trades. |
| 6 | **S2 / S3 / S7 re-evaluation** | low | All parked. Revisit only on logic rework. |
| 7 | **Optional: stop tracking `trades/trade_log.json` in git** | low | It's live per-bot data (VPS 667 lines vs repo stub). Currently `skip-worktree` on the VPS. Cleaner: `.gitignore` it + keep a committed `trade_log.example.json`. Not urgent. |
