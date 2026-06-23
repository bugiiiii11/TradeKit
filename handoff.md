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

## What Was Done (Session 43) — First bot trade + trailing SL validated

### VPS Deep Dive (P0)
Bot healthy after Flash project pm2 restart (not TradeKit-related). ↺=40, 0 unstable restarts. Clean SIGINT + recovery, position hydrated correctly from trade-log.

**S6 FIRST BOT TRADE:** SHORT @ $72,729, 0.00197 BTC, 8x isolated, entry 2026-06-01T08:30Z. Unrealized PnL +$19.40 (+108% ROE on $37.47 margin). BTC dropped ~13.5% since entry. SL was at $74,185 (2% above entry, 18% above current price).

Portfolio stats (all-time): 34 trades (9 open incl. manual), S6: 8 trades +$1.44, 37.5% WR.

### S6 Exit Logic Audit (P1)
Verified `shouldExitS6()` is independent of:
1. **EMA21 direction** — exit uses EMA8/EMA55 cross + BBWP cycle, not EMA21 (EMA21 only used for entry direction)
2. **Compression state** — `compress=55bars(FAIL)` only blocks new entries, not exits
3. **`modifyStopLoss()` failure** — try/catch in `checkTrailingStops()`, local state only updates after success

### Trailing SL Activated (P2)
Added `TRAILING_MODE=trailing` to VPS `.env`. Restarted bot. First bar close validated:
```
[Orders] Stop-loss modified: oid=451102111998 → new trigger $64092.7
[Trailing] S6 short: SL moved $74185.0 → $64092.7 (trailing_updated)
```
SL ratcheted $10,092 tighter. Position now locks in ~+$17 of +$19 gain. `modifyStopLoss()` removed from Untested Code Paths in CLAUDE.md.

### Flash Restart Note
OCI2 `pm2 restart all` triggered by Flash project deploy. Discord confirmed clean recovery: "1 position(s) restored from Hyperliquid", S1+S6 active, $399 bankroll. No TradeKit code/config changes.

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-06-21 | **WS bar-close loop liveness** (after S44 7-day-dead incident) | pm2 "online" does NOT mean the bar-close loop is alive — the S5 webhook server masks a dead WS. **Confirm bar-close logs are current**, not just that the process is up. Fix `bb3171e` should now self-heal (timeout → exit → pm2 restart), but verify it actually fired if an outage recurs. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 100 --nostream \| grep -iE 'Bar close\|S6-diag' \| tail -3"` — newest must be within ~15min of now |
| 2026-06-23 | S1 SHORT open + trailing SL | Entry $62,637 (0.00301 BTC, 10x isolated), opened 2026-06-23 08:15Z. uPnL ~+$0.29, trailing SL ratcheting down (was $63,249, from $64,512). Still ~1% above entry — stop-out here = small loss. Watch for exit. (Prior S6 LONG @ $62,191 closed Jun 21 +$2.67/4.41R `ema_reverse_cross`; an S6 short Jun 21–22 stopped out −$3.16 `native_sl` — both unlogged in S44.) | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 30 --nostream"` |
| 2026-06-23 | Trailing SL goes stale after restart/outage | Forensics found `[Trailing] Failed to modify SL: Cannot modify canceled or filled order` repeating Jun 20 19:00–22:15 — after the outage the S6 LONG's SL order ref was stale, so trailing was non-functional on that position until it exited. Failed safely (try/catch, no crash, strategy exit caught it +$2.67), but a post-restart position can lose trailing protection silently. **After any restart with an open position, confirm trailing actually modifies the SL (not erroring).** | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 50 --nostream \| grep -i 'Failed to modify SL'"` — must return nothing |
| 2026-05-06 | S5 cascade pipe LIVE | Receiving medium signals correctly. Monitor for first `high` severity signal. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 10 --nostream \| grep -i cascade"` |
| 2026-05-31 | Balance drift | Account value $377.54 (S6 LONG +$2.71 win, then S1 short −$3.15 loss since S44). Bot bankroll hydrates $358.47. Martin's manual trades likely source of earlier drift. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 5 --nostream \| grep Balance"` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Verify S44 reconnect fix holds** | low | `bb3171e` deployed + running. Can't force a HL outage to test the timeout path live. Watch that the next real WS drop self-heals (timeout → reconnect retries → exit/pm2 restart if 10 fail). Check Watchlist row 1 each session. |
| 2 | **Monitor S6 LONG + trailing SL** | low | Entry $62,191, SL ratcheting (was $61,942). Watch for exit (EMA8/55 cross or BBWP cycle). |
| 3 | **Post-trade analysis (closed SHORT)** | low | Full data now: S6 SHORT +$19.93 / 6.95R, exit `ema_reverse_cross`. Compare actual vs backtest; decide on leverage increase from 1.0x. |
| 4 | **Meta Signals summary → Martin** | low | S38 research done: no API/webhook, Discord-only. Recommend manual trade dashboard. Ask about $179/mo subscription. Also confirm VPS manual trading + balance. |
| 5 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (S28). Hydration fix (S32) protects web UI trades. |
| 6 | **S2 / S3 / S7 re-evaluation** | low | All parked. S2 disabled (S33), S3 structurally unfavorable, S7 backtest -$3. Revisit only on logic rework. |
