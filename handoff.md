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

## What Was Done (Session 38) — Trailing stop-loss: continuous trailing mode

### VPS Health Check
Bot healthy, ticking every 15m. Balance $320.67 (unchanged). Zero bot trades. S1 still blocked (Daily-EMA200=below). S6 BBWP=55.2 (above 50 but compress=20bars FAIL, EMA21=below/short). S5 receiving medium cascade signals (correctly ignored). Command bus auto-recovered from CHANNEL_ERROR.

### Trailing Mode (continuous) — deployed, inactive

Filled in the `trailing` branch of `evaluateTrailing()`. Three changes:

1. **`src/risk/trailing.ts`** — trailing mode: `newStop = markPrice × (1 ± TRAILING_DISTANCE)`, ratchet-only (never moves SL against position)
2. **`src/main-headless.ts`** — fixed `breakevenApplied` flag: only set for breakeven mode (one-shot), never for trailing (continuous)
3. **`src/scripts/test_trailing.ts`** — 16 new trailing test cases (long/short trails, ratchet holds, breakevenApplied ignored). All 37 tests pass (21 breakeven + 16 trailing).

Committed: `13a4866`. Deployed to VPS with `TRAILING_MODE=off` (zero-risk, same pattern as S37).

**Note:** VPS bot working directory is `/home/ubuntu/trading-bot` (not `TradeKit`).

### Meta Signals Research (P3 prep)

**What is it:** Algorithmic crypto signal service by Eric "Krown" Crown and "K-DUB" Crypto Zombie. Proprietary algorithms scan 65 pairs across 10 timeframes (30m to 24H) 24/7. Not a copy-trading platform — delivers trade ideas with SL/TP, trader executes manually.

**Signal format (confirmed fields):**
- Suggested entry price
- Suggested stop-loss (SL close above/below value)
- Suggested take-profit (with R:R ratio per target, e.g. 1:2)
- Timeframe (alerts organized by TF in Discord channels)
- Pair (65 pairs, BTC/ETH/SOL/majors against USDT)
- **Unknown:** direction (long/short) not explicitly documented on public pages, but implied by SL above (short) / SL below (long)

**Delivery:** Discord-only. Alerts auto-posted to channels in a private Discord server, organized by timeframe. **No API, no webhook, no programmatic access.**

**Signal frequency:**
- Pro (Mafioso/Mogul): 300+ alerts/month (algo-triggered, no human filter)
- Lite: 15-20 alerts/month (hand-curated by team, higher conviction)

**Cost:**
- **Mogul tier:** $179/month (billed quarterly) or $1,750/year
- **Mafioso NFT:** lifetime access, purchased with ETH (price not publicly listed, may be sold out)
- **Lite:** separate product, lower cost (exact price not found)

**Integration assessment:**
- **No direct integration path.** Discord-only, no API/webhook. To automate, we'd need a Discord bridge bot that:
  1. Joins the Meta Signals Discord server
  2. Parses alert messages from specific channels (fragile — format changes break the parser)
  3. Forwards parsed signals as HTTP POST to our webhook receiver (like S5 cascade)
- **Risk:** Discord ToS may prohibit automated message scraping. Meta Signals could change alert format without notice. Bridge bot adds a failure point.
- **Alternative:** Martin trades Meta Signals alerts manually via the dashboard manual trade card (already built, S28). No bot integration needed.
- **Recommendation:** Manual execution via existing dashboard is the pragmatic path. Bot integration only worthwhile if Meta Signals ever adds a webhook/API (ask their team via contact form at metasignals.io/contact).

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-05-08 | S1+S6 at 1.0x leverage | Monitor first bot trades. Balance $354.32, zero bot trades so far. S1 blocked by Daily-EMA200, S6 BBWP=97.6 (extreme high). S6 warmup + lookback fixed (S39). | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 50 --nostream"` |
| 2026-05-06 | S5 cascade pipe LIVE | Receiving medium signals correctly. Monitor for first `high` severity signal. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 10 --nostream \| grep -i cascade"` |
| 2026-05-11 | Trailing SL deployed (off) | Backtest (S40): trailing wins on PnL/DD/Sharpe. `TRAILING_MODE=off` until first real trade validates baseline SL. Then flip to `trailing`. | Add `TRAILING_MODE=trailing` to VPS `.env` + `pm2 restart trading-bot` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Monitor first trades at 1.0x (S1+S6)** | low | Zero bot trades so far. Validate sizing, fee impact, SL placement. Balance $357.92. S6 warmup + lookback fixed (S39). |
| 2 | **Activate trailing SL** | low | Backtest (S40) decided: `trailing` mode. After first trade confirms baseline SL → flip `TRAILING_MODE=trailing` on VPS. |
| 3 | **Meta Signals summary → Martin** | low | S38 research done: no API/webhook, Discord-only. Recommend manual trade dashboard. Ask about $179/mo subscription. Also confirm VPS manual trading + balance. |
| 4 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (S28). Hydration fix (S32) protects web UI trades. |
| 5 | **S2 re-evaluation** | low | Disabled (S33). Code intact. Revisit if entry logic fundamentally reworked. |
| 6 | **S3 re-evaluation** | low | Mean-reversion on BTC perps structurally unfavorable. Revisit if Martin fine-tunes StochRSI. |
| 7 | **S7 re-evaluation** | low | Parked: backtest -$3 PnL with 8h Binance rates. Revisit if Hyperliquid historical funding available. |
