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

## What Was Done (Session 42) — Health check only

S42: health check, no trade, S6 BBWP 17-21 oscillating (not breaking out yet), balance $358.38. No code work.

---

## What Was Done (Session 41) — Reconnect guard + data refresh

### VPS Health Check (P0)
Bot healthy, 25h uptime, ↺=37 (+1 from S40, normal WS reconnect). Balance $341.22 (down $13 from S40's $354.32 — likely funding on Martin's manual positions, zero bot trades). S1 blocked (Daily-EMA200=below). **S6 BBWP=3.6** (extreme low — full swing from 97.6 in S40). Compression counter working: `compress=0bars(ok)`, EMA21 flipping between above/below. S5 receiving medium cascade signals, correctly ignored. Supabase CHANNEL_ERROR auto-recovered.

### WS Reconnect Concurrency Fix (P1)
Investigated MaxListenersExceededWarning from S40. Root cause: **not** our candle consumer (uses Node 22 built-in WebSocket = EventTarget, no listener limit). Actual source: **Supabase Realtime** `@supabase/realtime-js` depends on `ws` package (EventEmitter, default max 10). On CHANNEL_ERROR reconnects, `ws` close listeners accumulate.

Fixed two things:
1. **`src/ws/candle-consumer.ts`** — added `reconnecting` guard flag with `try/finally` to prevent concurrent `reconnect()` calls from overlapping `setInterval` heartbeat ticks (real concurrency bug: if reconnect takes >30s, next tick races it)
2. **`src/main-headless.ts`** — `EventEmitter.defaultMaxListeners = 20` to suppress Supabase `ws` warning

### Backtest Data Refresh (P2)
Updated klines: May partial 672→2,931 rows (through May 31). 78,867 total rows, 27 files. Funding rates updated through May 31 (2,373 records).

**Changes:** `9ac6569`

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-06-09 | S6 SHORT open + trailing SL active | Entry $72,729, SL ratcheted to $64,093 (trailing mode). BTC ~$62,883. Monitor exit signal (EMA8/55 cross or BBWP cycle >85→<35). Trailing ratchets every 15m bar close. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 30 --nostream"` |
| 2026-05-06 | S5 cascade pipe LIVE | Receiving medium signals correctly. Monitor for first `high` severity signal. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 10 --nostream \| grep -i cascade"` |
| 2026-05-31 | Balance drift | $340.47 cross margin + $37.47 position margin = $377.94 total. S6 unrealized +$19.40. Martin's manual trades likely source of earlier drift. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 5 --nostream \| grep Balance"` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Monitor S6 SHORT trade + trailing SL** | low | First bot trade LIVE. Entry $72,729, SL trailing at $64,093, unrealized +$19.40. Watch for exit (EMA8/55 cross or BBWP cycle). Trailing validated S43. |
| 2 | **Post-trade analysis** | low | After S6 exits: review trade forensics, compare actual vs backtest behavior, decide on leverage increase from 1.0x. |
| 3 | **Meta Signals summary → Martin** | low | S38 research done: no API/webhook, Discord-only. Recommend manual trade dashboard. Ask about $179/mo subscription. Also confirm VPS manual trading + balance. |
| 4 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (S28). Hydration fix (S32) protects web UI trades. |
| 5 | **S2 re-evaluation** | low | Disabled (S33). Code intact. Revisit if entry logic fundamentally reworked. |
| 6 | **S3 re-evaluation** | low | Mean-reversion on BTC perps structurally unfavorable. Revisit if Martin fine-tunes StochRSI. |
| 7 | **S7 re-evaluation** | low | Parked: backtest -$3 PnL with 8h Binance rates. Revisit if Hyperliquid historical funding available. |
