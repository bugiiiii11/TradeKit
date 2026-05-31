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

## What Was Done (Session 40) — Trailing SL backtest + handoff trim

### VPS Health Check (P0)
Bot healthy, 13h uptime (pm2 restarted after WS reconnection failure — designed behavior, ↺=36). Balance $354.32 (down $3.60 from S39, likely funding). S6 seed counter confirmed working: `compress` incrementing correctly across bar closes (28→29→30→31). S6 BBWP=97.6 (extreme high, no compression). S1 blocked (Daily-EMA200=below). Zero bot trades. Minor `MaxListenersExceededWarning` during WS reconnect (event listener leak, not critical).

### Handoff Trim (P1)
Archived S35, S36, S37 to `docs/session-archive.md`. Handoff now holds S38–S40 only.

### Trailing SL Backtest (P2) — decision: trailing mode
Wired `evaluateTrailing()` into the backtest engine. Three-variant A/B/C test on 429 days of S1+S6 data with actual Binance funding rates.

**Mark price simulation:** bar HIGH (long) / bar LOW (short) — conservative. If trailing tightens SL and the same bar's adverse price hits the new SL, the position exits.

**Results (S1+S6, $500 bankroll, 5% margin):**

| Metric | Baseline | Breakeven | Trailing |
|--------|----------|-----------|----------|
| Trades | 177 | 194 | 222 |
| Win Rate | 46.3% | 54.6% | 47.3% |
| PnL | +$146 | +$174 | **+$181** |
| Profit Factor | 1.58 | 1.79 | 1.80 |
| Max DD | 6.0% | 4.2% | **4.1%** |
| Sharpe | 2.93 | 3.37 | **3.91** |
| SL Moves | — | 101 | 1,902 |
| Stop exits | 28 | 62 | 145 |

**Decision: TRAILING_MODE=trailing.** Wins on all three key metrics (PnL, drawdown, Sharpe). Stop-loss exit spike (28→145) is trailing doing its job — preempting signal exits to capture profit before pullbacks. Avg loss drops -$2.65→-$1.95.

**Do NOT activate yet.** `modifyStopLoss()` is still in Untested Code Paths. First trade should validate baseline SL mechanics. Then flip to trailing with data behind the decision.

**Changes:**
- `src/backtest/types.ts` — added `trailingMode`, `trailingDistance`, `breakevenBuffer` to config; `trailingSlMoves` to result
- `src/backtest/engine.ts` — trailing SL evaluation step before exit checks, `breakevenApplied` state tracking
- `src/scripts/backtest_trailing.ts` — A/B/C test script

---

## What Was Done (Session 39) — S6 warmup fix + lookback calibration

### VPS Health Check
Bot healthy, 39h uptime, zero unstable restarts. Balance $357.92. Zero bot trades. S1 blocked by Daily-EMA200=below. S6 BBWP oscillating 22–78, never entering deep compression (<20). S5 cascade receiving medium signals (correctly ignored).

### Balance Investigation (P0)
$320.67 → $357.92 explained: Martin's manual trades on VPS account via Hyperliquid web UI. 51 fills over 14 days, net PnL -$35.71, fees -$4.54, funding -$0.76. The $320.67 was withdrawable with margin locked for a 0.0125 BTC LONG (May 8–13). No deposits. Starting balance was ~$399, now $357.92.

### S6 Warmup Gap Fixed (P1)
After every pm2 restart, `barsSinceCompression` started at Infinity — S6 was blind to compression that happened before boot. Fixed by:
- `s6_bbwp_breakout.ts` — added `seedS6Compression()` that replays historical 1H BBWP through the counter
- `candle-consumer.ts` — added `getHistoricalBBWP1H()` to expose warmup data
- `main-headless.ts` — calls seed after consumer starts
- 7 unit tests in `test_s6_seed.ts`, all pass

### COMPRESSION_LOOKBACK 10→40 (P2)
Stale comment said "4H bars (~40 hours)" but S6 runs on 1H — actual window was 10 hours, not 40. Ran 26-month A/B backtest (`backtest_s6_lookback.ts`):
- Lookback=10: 139 trades, 44.6% WR, +$109.79 PnL, 5.4% max DD
- Lookback=40: 183 trades, 45.9% WR, +$147.02 PnL, 5.9% max DD
- Same profit factor (1.56). Lookback=40 wins — +34% more PnL, +32% more trades.

Changed default to 40, fixed all stale "4H" comments to "1H".

### Deployed to VPS
Committed `a15ad8e`, pushed, deployed via `git pull && npx tsc && pm2 restart trading-bot`. Verified seed message in logs: `[S6] Compression counter seeded from 112 historical 1H bars — barsSinceCompression=67`. First S6-diag shows `compress=68bars(FAIL)` (correct — no compression <20 in 67h).

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-05-08 | S1+S6 at 1.0x leverage | Monitor first bot trades. Balance $341.22, zero bot trades. S1 blocked (Daily-EMA200=below). **S6 BBWP=3.6** (deep compression, full swing from 97.6 in S40). `compress=0bars(ok)` — counter just reset, S6 armed. Watch BBWP trajectory toward 50. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 50 --nostream"` |
| 2026-05-06 | S5 cascade pipe LIVE | Receiving medium signals correctly. Monitor for first `high` severity signal. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 10 --nostream \| grep -i cascade"` |
| 2026-05-11 | Trailing SL deployed (off) | Backtest (S40): trailing wins on PnL/DD/Sharpe. `TRAILING_MODE=off` until first real trade validates baseline SL. Then flip to `trailing`. | Add `TRAILING_MODE=trailing` to VPS `.env` + `pm2 restart trading-bot` |
| 2026-05-31 | Balance drift | $341.22 — down $13 from S40 ($354.32) with zero bot trades. Likely funding on Martin's manual positions. Confirm with Martin if continues trending. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 5 --nostream \| grep Balance"` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Monitor first trades at 1.0x (S1+S6)** | low | Zero bot trades. Balance $341.22. S6 BBWP=3.6 (deep compression) — closest to first trade yet. Watch BBWP trajectory toward 50. Reconnect guard deployed (S41). |
| 2 | **Activate trailing SL** | low | Backtest (S40) decided: `trailing` mode. After first trade confirms baseline SL → flip `TRAILING_MODE=trailing` on VPS. |
| 3 | **Meta Signals summary → Martin** | low | S38 research done: no API/webhook, Discord-only. Recommend manual trade dashboard. Ask about $179/mo subscription. Also confirm VPS manual trading + balance. |
| 4 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (S28). Hydration fix (S32) protects web UI trades. |
| 5 | **S2 re-evaluation** | low | Disabled (S33). Code intact. Revisit if entry logic fundamentally reworked. |
| 6 | **S3 re-evaluation** | low | Mean-reversion on BTC perps structurally unfavorable. Revisit if Martin fine-tunes StochRSI. |
| 7 | **S7 re-evaluation** | low | Parked: backtest -$3 PnL with 8h Binance rates. Revisit if Hyperliquid historical funding available. |
