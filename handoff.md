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

## What Was Done (Session 35) — Health check + dashboard validation

### VPS Health Check
Bot online 42h, zero unstable restarts, zero errors. Balance $320.67 (unchanged). 82 bar closes processed, all "No signals." S1 blocked by `Daily-EMA200=below`. S6 BBWP in extreme compression (0.4) — waiting for breakout above 50. Command bus recovered from one `CHANNEL_ERROR` (auto-reconnect after 1 retry).

### S5 Cascade Webhook
10 cascade signals received (all `severity=medium`, $25-27M impact, Ethereum). All correctly ignored — S5 requires `high` severity. Pipe confirmed working.

### Dashboard Controls Validated
Martin tested on production (`trade-kit.vercel.app`): S1/S6 toggles work, leverage slider works. Full command bus round-trip confirmed. Quote: "leverage je mega funkcia" (leverage is a great feature).

### Martin Feature Requests
1. **Trailing stop-loss** — auto-move SL into profit on winning trades
2. **Meta Signals integration** — external signal provider (Krown recommends, claims high win rate)

Both captured in What To Do Next. No code changes this session.

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

## What Was Done (Session 36) — Trailing stop-loss design research

### VPS Health Check
Bot healthy, ticking every 15m. Balance $320.67 (unchanged). Zero bot trades. S6 BBWP climbed from 0.4 → 30.2 (approaching 50 breakout threshold, EMA21=above/long). S5 still receiving medium cascade signals (correctly ignored). No errors.

### Trailing Stop-Loss Design
Researched and designed bot-managed trailing SL via Hyperliquid `modify()` (no native trailing support). Three modes: off/breakeven/trailing. Full design archived to `docs/session-archive.md` — implemented in S37 (breakeven) and S38 (trailing).

---

## What Was Done (Session 37) — Trailing stop-loss implementation (breakeven mode)

### Trailing Stop-Loss (breakeven mode) — deployed, inactive

Implemented bot-managed trailing SL using Hyperliquid SDK `modify()`. Four changes:

1. **`src/hyperliquid/orders.ts`** — added `modifyStopLoss()` function (modifies trigger order `triggerPx` by OID)
2. **`src/main-headless.ts`** — added `TrailingMode` type, env var parsing (`TRAILING_MODE`, `TRAILING_DISTANCE`, `BREAKEVEN_BUFFER`), `trailingMode`+`breakevenApplied` fields on `ActivePosition`, `checkTrailingStops()` in main loop (step 3.5, after reconciliation)
3. **`src/risk/trailing.ts`** (new) — pure function `evaluateTrailing()`: checks activation threshold, returns new SL at entry ± buffer, ratchet-only
4. **`src/scripts/test_trailing.ts`** (new) — 21 unit tests (both directions, edge cases). All pass.

**Design decisions:**
- Breakeven activates when mark price moves ≥ `TRAILING_DISTANCE` (2%) in our favor
- SL moves to entry + `BREAKEVEN_BUFFER` (0.1%) to avoid spread/slippage stops
- One-time move, then static (no continuous trailing — that's S38)
- If `modify()` fails, logs error but keeps existing SL (stale > none)
- Manual positions excluded from trailing logic

Committed: `17331cf`. Deployed to VPS with `TRAILING_MODE=off` (zero-risk). Will activate `breakeven` after first real bot trade validates baseline SL flow.

### VPS Health Check
Bot healthy, ticking every 15m. Balance $320.67 (unchanged). S6 BBWP=62.3 (crossed 50 but EMA21=below/short direction). S1 still blocked by Daily-EMA200=below. Martin's manual position hydrated correctly on restart.

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
| 2026-05-08 | S1+S6 at 1.0x leverage | Monitor first bot trades. Balance $357.92, zero bot trades so far. S1 blocked by Daily-EMA200, S6 BBWP not in compression. S6 warmup + lookback fixed (S39). | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 50 --nostream"` |
| 2026-05-06 | S5 cascade pipe LIVE | Receiving medium signals correctly. Monitor for first `high` severity signal. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 10 --nostream \| grep -i cascade"` |
| 2026-05-11 | Trailing SL deployed (off) | Both breakeven + trailing modes on VPS, `TRAILING_MODE=off`. Activate after first real bot trade confirms baseline SL. | Add `TRAILING_MODE=breakeven` (or `trailing`) to VPS `.env` + `pm2 restart trading-bot` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Monitor first trades at 1.0x (S1+S6)** | low | Zero bot trades so far. Validate sizing, fee impact, SL placement. Balance $357.92. S6 warmup + lookback fixed (S39). |
| 2 | **Activate trailing SL** | low | Both modes deployed (S37+S38). After first trade confirms baseline SL → flip `TRAILING_MODE=breakeven` or `trailing` on VPS. |
| 3 | **Meta Signals summary → Martin** | low | S38 research done: no API/webhook, Discord-only. Recommend manual trade dashboard. Ask about $179/mo subscription. Also confirm VPS manual trading + balance. |
| 4 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (S28). Hydration fix (S32) protects web UI trades. |
| 5 | **S2 re-evaluation** | low | Disabled (S33). Code intact. Revisit if entry logic fundamentally reworked. |
| 6 | **S3 re-evaluation** | low | Mean-reversion on BTC perps structurally unfavorable. Revisit if Martin fine-tunes StochRSI. |
| 7 | **S7 re-evaluation** | low | Parked: backtest -$3 PnL with 8h Binance rates. Revisit if Hyperliquid historical funding available. |
