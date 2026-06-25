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

## What Was Done (Session 44) — P0: WS loop dead 7 days (reconnect deadlock) — recovered + fixed

### VPS Deep Dive uncovered a silent P0 (was reported "healthy")
pm2 showed `trading-bot` online, 10D uptime, ↺=40, error log empty since Jun 16 — **looked healthy**. It was not. On-chain + Supabase forensics revealed the **15m WebSocket bar-close loop had been dead since 2026-06-13 09:02** while the process stayed "online" (only the S5 cascade webhook HTTP server kept logging, masking it).

**Timeline (Jun 13):** `09:00` last good bar close → `09:01:46` `[WS] No message in 66s — reconnect attempt 1/10` (Hyperliquid 502 outage) → `09:02:09` Digest error HTTP 502 → **then nothing for 7 days.** No "attempt 2/10", no bar closes, no trailing updates, no exits, no entries.

**Root cause:** `reconnect()` sets `reconnecting=true` then `await subsClient.candle()`, which **hung without settling** during the outage. The `finally` that clears `reconnecting` never ran; the heartbeat guard `if (this.reconnecting) return` then suppressed every future reconnect. Flag pinned `true` forever → process never crashed → self-heal (`MAX_RECONNECT_ATTEMPTS → process.exit(1)`) never triggered. The S41 reconnect guard introduced this deadlock class (correct guard, but its gated awaits had no timeout).

**Fix (`bb3171e`, deployed to VPS):** added `withTimeout()` around **every** network await in `subscribe()`/`reconnect()` — subscribe (20s), REST gap-fill (20s), unsubscribe, dispose. On timeout the await rejects → `finally` clears `reconnecting` → next heartbeat retries → eventually `process.exit(1)` → pm2 restart. Type-checks clean. Bot restarted twice (recover, then patched), both clean: position hydrated from trade-log, WS subscribed, bar closes flowing.

### Trade forensics (the two S43 follow-ups)
- **S43 SHORT closed a WIN:** S6, entry $72,729 → exit $62,613, **+$19.93 / 6.95R**, exit reason `ema_reverse_cross` (strategy exit fired, *not* the stop — trailing rode alongside). Closed 2026-06-09 13:00.
- **New open position is also S6:** BBWP breakout **LONG** @ $62,191 (0.00243 BTC, 8x), entered 2026-06-10 17:00 (`BBWP=56.3 cross50=YES EMA21=above`). During the 7-day outage its trailing SL was frozen at $60,988 (no harm — static stop held, never hit). Post-recovery, trailing resumed and ratcheted SL $60,988 → $61,942. Currently ~+$3 (−$0.89 funding).
- Forensics tool added: `src/scripts/investigate_long.ts` (Supabase trades/positions/bot_logs queries).

### Balance
Account value $381.22 (S43's +$19.93 SHORT win compounded in). Bot bankroll hydrates at $359.45.

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-06-21 | **WS bar-close loop liveness** (after S44 7-day-dead incident) | pm2 "online" does NOT mean the bar-close loop is alive — the S5 webhook masks a dead WS. **`pm2 logs --nostream` LIES (serves stale buffered lines, S46) — read the log FILE directly and cross-check the exchange clock.** Don't trust your local machine clock either (was 35h off in S46). Fix `bb3171e` self-heals (timeout → exit → pm2 restart); verify it fired if an outage recurs. | Liveness: `ssh … "tail -5 /home/ubuntu/.pm2/logs/trading-bot-out.log"` — newest "Bar close" must be within ~15min. Exchange clock: `curl -s -X POST https://api.hyperliquid.xyz/info -d '{"type":"candleSnapshot","req":{"coin":"BTC","interval":"15m","startTime":1750000000000,"endTime":1790000000000}}'` → last candle `T` = real time |
| 2026-06-25 | S1 SHORT open — static $61,050 floor (not trailing) | Entry $62,637 (0.00301 BTC, 10x isolated), opened Jun 23 08:15Z. S46 manually set SL to $61,050 (oid `479697922460`, locks ~+$4.78). **Trailing is OFF on this position** — hydration misread the below-entry stop as a TP (`stopOid` undefined, see row below), so it won't ratchet further. Stop is a real exchange trigger; protection intact. Watch for exit (strategy `ema_reverse_cross` or the $61,050 stop). | `ssh … "tail -30 /home/ubuntu/.pm2/logs/trading-bot-out.log"` + `curl … openOrders` for the resting stop |
| 2026-06-25 | **Hydration misclassifies a trailed-into-profit stop as a TP** (found S46) | `main-headless.ts:122` classifies SL vs TP by trigger-price-vs-entry. A stop trailed past entry (below entry for a short / above for a long) is read as a TP on restart → `stopOid` undefined → trailing skipped for that position. Money is safe (real SL trigger stays on the book), but trailing silently stops. **Real fix: classify by the order's `tpsl` field, not price.** | On any restart with an open profitable position, check the hydration log line — if it says `SL=$… (estimated), N TP(s)` and you placed no TP, the stop was misread. |
| 2026-05-06 | S5 cascade pipe LIVE | Receiving medium signals correctly. Monitor for first `high` severity signal. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "tail -200 /home/ubuntu/.pm2/logs/trading-bot-out.log \| grep -i cascade \| tail"` |
| 2026-05-31 | Balance drift | Account value ~$386 (S1 SHORT uPnL ~+$8.5 unrealized; realized net −$3.16 since S44). Bot bankroll hydrates $358.47. Martin's manual trades likely source of earlier drift. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "tail -5 /home/ubuntu/.pm2/logs/trading-bot-out.log \| grep Balance"` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Verify B fix (oid capture) on next trade** | low | `aa15560` deployed. The CURRENT S1 SHORT won't trail (hydration quirk), so the fix proves out on the *next* position with a normal above-entry stop: confirm `[Orders] Stop-loss modified: oid=X → Y` (new oid Y differs) and NO `Failed to modify SL`. Self-heal also covers stale refs. |
| 2 | **Fix hydration SL/TP misclassification** | med | `main-headless.ts:122` — classify by the order's `tpsl` field, not trigger-price-vs-entry, so a stop trailed into profit isn't read as a TP on restart (Watchlist row 3). Until fixed, any restart with a profitable position loses trailing on it. |
| 3 | **Monitor S1 SHORT to exit** | low | Static $61,050 floor (oid `479697922460`), entry $62,637, won't trail further. Watch for `ema_reverse_cross` exit or stop. |
| 4 | **Verify S44 reconnect fix holds** | low | `bb3171e` running. Can't force a HL outage. Watch next real WS drop self-heals (timeout → retries → exit/pm2 restart if 10 fail). Watchlist row 1. |
| 5 | **Leverage decision (still 1.0x)** | low | Ledger small/mixed: S6 LONG +$2.67/4.41R, S6 SHORT −$3.16, S43 SHORT +$19.93/6.95R. Likely needs more closed trades before bumping. |
| 6 | **Meta Signals summary → Martin** | low | S38: no API/webhook, Discord-only. Recommend manual trade dashboard. Ask about $179/mo subscription. Confirm VPS manual trading + balance. |
| 7 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (S28). Hydration fix (S32) protects web UI trades. |
| 8 | **S2 / S3 / S7 re-evaluation** | low | All parked. S2 disabled (S33), S3 structurally unfavorable, S7 backtest -$3. Revisit only on logic rework. |
