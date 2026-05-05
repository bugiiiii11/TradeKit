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

## What Was Done (Session 26) — Position hydration + bug fixes + deep dive

### Hydrate activePositions on Restart
Implemented position hydration from Hyperliquid on bot startup. Queries live positions (direction, entryPrice, sizeBase, leverage, marginUsed) + open trigger orders via `frontendOpenOrders` API to recover SL/TP OIDs. Infers strategy from TP count (3 TPs = S3) and leverage. Finds actual entry time from 48h fill history (most recent matching fill).

Files: `src/hyperliquid/account.ts` (added `leverage`/`marginUsed` to `PositionInfo`, added `getOpenBtcTriggerOrders()`), `src/main-headless.ts` (`hydrateActivePositions()` called from `main()` after risk state hydration). Committed: `bb1998e`.

**Live validation:** Restarted VPS with S3 short open. Hydration correctly detected position, recovered all 4 OIDs (1 SL + 3 TPs), inferred S3. On next bar close, `checkExits` properly canceled orders by OID and closed position.

### roundSize Floating-Point Fix
`Math.floor(0.00007 * 100000)` = 6 due to IEEE 754. TP orders were placed 8% smaller than intended (0.00006 instead of 0.00007), leaving dust uncovered. Fix: `Math.floor(x + 1e-9)`. File: `src/hyperliquid/orders.ts`. Committed: `2730e2c`.

### Hydration Entry Timestamp Fix
Fill lookup sorted oldest-first, matching a previous trade's fill at similar price instead of the actual entry. Caused `max_hold_time` exit immediately after restart. Fix: sort most-recent-first. File: `src/main-headless.ts`. Committed: `d7f51a1`.

### WebSocket Listener Leak Fix
`subscribe()` assigned `this.transport` before `candle()` could throw, leaving orphaned transports with close listeners on each failed reconnect attempt. Caused `MaxListenersExceededWarning` after 8 attempts. Fix: use local vars, only assign on success, dispose immediately on failure. File: `src/ws/candle-consumer.ts`. Committed: `1a8b0ff`.

### VPS Deep Dive
- WS died ~45 min after first deploy, reconnect/pm2 restart cycle worked correctly
- 3 S3 trades today: long +$0.014, long +$0.040, short -$0.007
- S2 diagnostics bullish (BBWP=2.0, 1H-EMA=bull) but no retest yet
- Supabase `trades_source_check` verified: all 10 recent trades have `source=vps-bot`

---

## What Was Done (Session 25) — VPS deep dive + filter relaxation backtest

### Supabase Realtime Log Noise Fix
Investigated `[Commands] Realtime subscription CHANNEL_ERROR` flooding VPS error logs. The subscription auto-recovers via Supabase's built-in retry, but logged every single retry attempt. Fixed to only log state transitions (first error + recovery with retry count). Files: `src/db/commands.ts`. Committed: `e808d63`.

### VPS Bot Deep Dive (~40h of logs)
Bot healthy: 15h uptime, 182 bar closes, WebSocket stable, all 3 strategies evaluating. Zero trades — market conditions not meeting entry criteria:
- **S3:** 28 crosses detected, 6 had BBWP<40, but OB/OS extremes never aligned with EMA21 proximity
- **S2:** 20 evals, 7 had BBWP<35, but `1H-EMA=bear` in ALL 20 evaluations (never once bullish)
- **S1:** One LONG cross detected but blocked by `Daily-EMA200=below`
- BBWP spiked from 18 to 97.2 over 24h (massive vol expansion)

### Filter Relaxation A/B Backtest
Made S3 OB/OS thresholds and S2 1H-EMA requirement configurable (`S3_CONFIG`, `S2_CONFIG`). Ran 4-variant comparison on 379-day / 24-month Binance data:

| Variant | Trades | Win Rate | PnL | Max DD | Verdict |
|---------|--------|----------|-----|--------|---------|
| Baseline | 474 | 30.4% | +$25.50 | 10.7% | Current |
| S3 75/25 | 531 (+57) | 30.9% | +$22.79 | 11.0% | REJECT |
| S2 no 1H-EMA | 477 (+3) | 30.4% | +$25.44 | 10.7% | REJECT |
| Both | 532 (+58) | 31.0% | +$23.65 | 10.8% | REJECT |

**All relaxations rejected.** Extra trades are net-negative. Current filters are already optimal. S1 remains the portfolio driver (10 trades, 70% WR, +$79).

Files: `src/strategy/s2_mean_reversion.ts`, `src/strategy/s3_stoch_rsi.ts` (configurable thresholds), `src/scripts/backtest_relaxed.ts` (new). Committed: `3c35125`.

### Concurrent Position Bug Fixes (critical)
Second VPS check revealed bot had started trading (first S2+S3 live trades!). Found two critical bugs:

1. **Leverage conflict:** S3 (1x) couldn't open when S2 (2x) was open — Hyperliquid rejects leverage decreases on isolated positions. Crashed entire bar evaluation via `ensureLeverage`.
2. **Stop cleanup nuke:** `closePosition` canceled ALL reduce-only BTC orders, including stops belonging to other strategies' open positions. Left S2 naked after S3 exit.

**Root cause:** Hyperliquid has one isolated position per asset, but bot treated S2/S3 as independent positions.

**Fixes:**
- Block new entries when any position already open (`activePositions.length > 0` guard)
- Track SL/TP order IDs per position (`stopOid`, `tpOids[]` on `ActivePosition`)
- Cancel only that position's specific OIDs on exit, call `closePosition(dir, skipStopCleanup=true)`
- `closePosition` gains `skipStopCleanup` param (default false — kill switch still gets blanket cleanup)

Files: `src/main-headless.ts`, `src/hyperliquid/orders.ts`. Committed: `85255e2`. Deployed to VPS, pm2 restarted.

**Trade results:** ~5 S2 shorts over 2 days, net loss -$1.64 at 0.25x leverage. Balance: $398.94 → $397.30. First live S2 trades confirmed working.

**Known gap:** `activePositions` not hydrated from Hyperliquid on restart — bot opened a new S2 immediately after restart because it didn't know about existing positions. Pre-existing issue, low priority (positions have native stops).

---

## What Was Done (Session 27) — Health check + leverage scale-up

### VPS Health Check
Bot healthy: 42h uptime, 0 unstable restarts, error log empty. WS listener leak fix holding — no crash/reconnect loops. 86 bar closes processed. One S2 long @ $78,474 closed at +$0.84 (+4.21%). Balance: $397.30 → $398.14. BBWP 92-96 (extreme vol expansion) correctly blocking most entries. Hydration never fired (no WS crashes required restart).

### Leverage Scale-Up
Changed `LEVERAGE_MULT` from 0.25 to 0.5 in VPS `.env`. Restarted with `pm2 restart trading-bot --update-env`. Bot startup clean, warmup loaded (1500 15m + 251 4H + 251 1D bars). Effective leverage now: S1=5x, S2=4x (on 5% margin). Next trades will be ~double previous size.

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-05-05 | VPS bot at 0.5x leverage | Scaled from 0.25x to 0.5x (Session 27). S26 fixes stable (42h clean run). Balance $398.14. Monitor first few trades at new sizing for correct margin/leverage. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 30 --nostream"` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **S4 Grid strategy research** | med | Regime filter now exists as shared infra (`src/backtest/regime-filter.ts`). Build grid strategy on Hyperliquid perps, backtest on 24-month Binance data with funding rates + regime filter. See auto-memory for full analysis. |
| 2 | **Scale to full leverage (1.0x)** | low | Currently at 0.5x (Session 27). After ~10-15 trades at 0.5x confirm stable sizing, bump to 1.0x. Same process: edit `.env` + `pm2 restart --update-env`. |
| 3 | **Port concurrent position fix to desktop bot** | low | `main.ts` has same `closePosition` + `cancelOpenBtcStops` pattern. Not urgent (desktop bot rarely used). |
| 4 | **TradingView indicator validation** | low | Compare local vs TV values. Run `validate_indicators.ts` when TV Desktop available. |
| 5 | **Remove diagnostic logging when stable** | low | Once trading consistently, remove S1/S2/S3 diag sends (or keep signals channel muted). |
| 6 | **New strategy development** | med | Colleague finds setups on TV → writes rules → we code + backtest → deploy. |
