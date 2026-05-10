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

## What Was Done (Session 34) — Dashboard control panel + decision gate fix

### Dashboard Control Panel (all three priorities shipped)

**P1: Bot Status Card** — new `frontend/src/components/bot-status-card.tsx`. Consolidated operational health card with:
- Health indicator (Online/Stale/Offline/Killed/Paused) with colored left border + pulsing dot
- Last tick timestamp + staleness coloring (>20min = stale, >1hr = offline)
- Source badge (vps-bot/tv-bot), drawdown (daily/weekly), consecutive losses
- Kill/pause detail integrated (standalone banners removed)
- Kill switch button moved from header into this card

**P2: Strategy Toggles + S1 Filter** — runtime overrides via command bus:
- Bot: `handleToggleStrategy` + `handleToggleS1Filter` in `src/commands/handlers.ts`
- Extended `CommandHandlerContext` with `toggleStrategy`/`getEnabledStrategies` callbacks
- Frontend: `frontend/src/components/strategy-controls.tsx` — S1/S6 toggle buttons + S1 Daily-EMA200 filter toggle
- State restored from last completed command result in `bot_commands` table
- All overrides are temporary — reset on bot restart (per design)

**P3: Leverage Slider** — same command bus pattern:
- Bot: `handleSetLeverage` (0.25x–2.0x), `LEVERAGE_MULT` changed from `const` to `let`
- Frontend: preset step buttons with effective per-strategy leverage display

**Desktop bot** (`src/main.ts`): no-op implementations for new context methods (strategies/leverage managed by VPS bot only).

Committed: `2983d3d`. Deployed: Vercel auto-deploy (frontend), VPS `git pull` + `pm2 restart` (bot).

### Decision Gate Bug Fix
`src/scripts/backtest_binance.ts` decision gate now evaluates all strategies (S1/S2/S3/S6) instead of only S1/S2/S3. Skips strategies with zero trades. Dynamic count (`viable/evaluated` instead of hardcoded `viable/3`). Confirmed working: S6 correctly shows "POSITIVE EXPECTANCY" (115 trades, +$76.09).

Committed: `9af3911`. VPS `git pull` (no restart needed — backtest script only).

### Hydration Fix Validated
On restart, bot correctly hydrated Martin's manual long position as `"external (skip exit logic)"` — the trade-log cross-check from S32 is working as designed. This retires the hydration fix watchlist item.

### Balance Note
VPS balance $320.67 (down ~$50 from S33). Zero bot trades — all losses are Martin's manual web UI trades. Not a code issue.

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

## What Was Done (Session 36) — Trailing stop-loss design research

### VPS Health Check
Bot healthy, ticking every 15m. Balance $320.67 (unchanged). Zero bot trades. S6 BBWP climbed from 0.4 → 30.2 (approaching 50 breakout threshold, EMA21=above/long). S5 still receiving medium cascade signals (correctly ignored). No errors.

### Trailing Stop-Loss Design

**Research finding:** Hyperliquid does NOT support native trailing stops. SDK order types are limited to fixed-price trigger orders (stop-market, stop-limit, TP-market, TP-limit). No trailing distance parameter exists.

**Approach: bot-managed trailing via `modify()`.** The SDK's `modify()` method can update an existing trigger order's `triggerPx` by OID. The bot already polls positions every 15m bar close.

**Implementation plan:**

1. **Track SL order OID** — `setStopLoss()` already returns the order response. Store the OID in `activePositions` alongside entry price and current SL price.

2. **Trailing modes** (configurable per strategy via env var):
   - `breakeven` — once price moves ≥ X% in our favor, move SL to entry price. One-time move, then static. Simplest, lowest risk.
   - `trailing` — SL follows price at a fixed distance (e.g., 2%). Moves only in favorable direction (ratchet). Checked every 15m bar close.
   - `off` — current behavior (fixed SL, never moved).

3. **Trailing logic** (in main loop, after position check):
   - If position open + trailing enabled → get current mark price
   - Calculate new SL: `markPrice × (1 - trailPct)` for longs, `× (1 + trailPct)` for shorts
   - If new SL is more favorable than current SL → `exchange.modify(oid, newTriggerPx)`
   - Never move SL against the position (ratchet only)
   - Log every SL move to Discord signals channel

4. **Config** (env vars):
   - `TRAILING_MODE=off|breakeven|trailing` (default: `off`)
   - `TRAILING_DISTANCE=0.02` (2%, used for both breakeven threshold and trail distance)
   - Per-strategy override possible later, but start with global

5. **Edge cases:**
   - 15m granularity means SL lags price by up to 15 minutes — acceptable for 4H+ strategies (S1/S6), risky for S3-style 15m plays
   - If `modify()` fails, log error but don't cancel existing SL — stale SL is better than no SL
   - On position close, existing cleanup (`cancelOpenBtcStops`) handles orphaned orders

**Decision: start with `breakeven` mode.** It's the safest first step — locks in risk-free trades without the complexity of continuous trailing. Add `trailing` mode in a follow-up session.

**Code changes needed (S37):**
- `src/hyperliquid/orders.ts` — return OID from `setStopLoss()`
- `activePositions` type — add `slOid`, `slPrice`, `trailingMode` fields
- Main loop — add trailing check after position reconciliation
- New file: `src/risk/trailing.ts` — trailing logic (calculate new SL, decide whether to move)

No code changes this session. Design only.

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

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-05-08 | S1+S6 at 1.0x leverage | Monitor first bot trades. Balance $320.67, zero bot trades so far. S1 blocked by Daily-EMA200, S6 BBWP crossed 50 but EMA21=below (short direction). | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 50 --nostream"` |
| 2026-05-06 | S5 cascade pipe LIVE | Receiving medium signals correctly. Monitor for first `high` severity signal. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 10 --nostream \| grep -i cascade"` |
| 2026-05-11 | Trailing SL deployed (off) | Code on VPS but `TRAILING_MODE=off`. Activate `breakeven` after first real bot trade confirms baseline SL. | Add `TRAILING_MODE=breakeven` to VPS `.env` + `pm2 restart trading-bot` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Monitor first trades at 1.0x (S1+S6)** | low | Zero bot trades so far. Validate sizing, fee impact, SL placement. Balance $320.67. |
| 2 | **Activate trailing breakeven** | low | Code deployed (S37). After first trade confirms baseline SL → flip `TRAILING_MODE=breakeven` on VPS. |
| 3 | **Trailing stop-loss — trailing mode** | med | Continuous trail (S38). SL follows price at fixed distance. Needs `evaluateTrailing()` trailing branch. |
| 4 | **Meta Signals integration** | med | Martin request (S35). External signal provider (Krown recommends). Research their API/webhook format before committing. |
| 5 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (S28). Hydration fix (S32) protects web UI trades. |
| 6 | **S2 re-evaluation** | low | Disabled (S33). Code intact. Revisit if entry logic fundamentally reworked. |
| 7 | **S3 re-evaluation** | low | Mean-reversion on BTC perps structurally unfavorable. Revisit if Martin fine-tunes StochRSI. |
| 8 | **S7 re-evaluation** | low | Parked: backtest -$3 PnL with 8h Binance rates. Revisit if Hyperliquid historical funding available. |
