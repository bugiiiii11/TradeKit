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

## What Was Done (Session 33) — 26-month backtest validation, S2 disabled

### 26-Month Backtest
Ran S1+S2+S6 on full 26-month Binance data (March 2024 → May 2026, 76k rows, 429-day window after warmup). Results weaker than the 12-month window: **+$133.66 (+26.7%), 156 trades, PF 1.59, Sharpe 2.53**. Extra months added unfavorable regimes.

Per-strategy: S1 +$87 (9 trades, 78% WR — sniper), S6 +$76 (105 trades, 46% WR — workhorse), **S2 -$30 (42 trades, 31% WR — net drag)**.

### S2 Removal Confirmed
Ran S1+S6-only backtest: **+$165.74 (+33.1%), 124 trades, PF 1.92, Sharpe 3.45**. Every metric improved. S6 picked up 10 extra trades from freed position slots. S1 gained slightly (+$87→$89).

### S2 Disabled on VPS
Changed `ENABLED_STRATEGIES=S1,S6` in VPS `.env`, restarted pm2. Startup confirms: `Strategies: S1, S6`. S2 code untouched — can be re-enabled for future experiments. No code changes this session.

### Balance Note
VPS balance $370.63 (down from $390 in S32). Zero bot trades — drop is from Martin's manual web UI trades. Hydration fix (S32) prevents bot interference with manual trades.

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

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-05-08 | S1+S6 at 1.0x leverage | Monitor first bot trades. Balance $320.67, zero bot trades so far. S1 blocked by Daily-EMA200, S6 BBWP in extreme compression (0.4). | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 50 --nostream"` |
| 2026-05-06 | S5 cascade pipe LIVE | Receiving medium signals correctly. Monitor for first `high` severity signal. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 10 --nostream \| grep -i cascade"` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Monitor first trades at 1.0x (S1+S6)** | low | Zero bot trades so far. Validate sizing, fee impact at full leverage. Balance $320.67. |
| 2 | **Trailing stop-loss** | med | Martin request (S35). Auto-move SL into profit on winning trades. Design: breakeven-move vs true trailing. Research Hyperliquid native trailing support first. |
| 3 | **Meta Signals integration** | med | Martin request (S35). External signal provider (Krown recommends). Research their API/webhook format before committing. |
| 4 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (S28). Hydration fix (S32) protects web UI trades. |
| 5 | **S2 re-evaluation** | low | Disabled (S33). Code intact. Revisit if entry logic fundamentally reworked. |
| 6 | **S3 re-evaluation** | low | Mean-reversion on BTC perps structurally unfavorable. Revisit if Martin fine-tunes StochRSI. |
| 7 | **S7 re-evaluation** | low | Parked: backtest -$3 PnL with 8h Binance rates. Revisit if Hyperliquid historical funding available. |
