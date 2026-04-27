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

## What Was Done (Session 22) — Fix all strategies broken (NaN indicators) + Discord signals

**Root cause found:** VPS bot was running for 2+ days with every strategy silently broken due to insufficient warmup data producing NaN indicators. Zero trades were possible.

### Fixes (5 commits, all deployed to VPS)
1. **Fixed 422 leverage error** — Hyperliquid requires integer leverage. 0.25x multiplier produced 1.3x for S3. Changed to `Math.round()`. Committed: `334b47d`.
2. **Fixed 1H BBWP/PMARP always NaN** — 700 bars of 15m = 175 bars of 1H, but BBWP needs 264 and PMARP needs 369. Increased buffer to 1500 (→375 bars of 1H). Committed: `cfc6923`.
3. **Fixed S1 permanently dead** — 4H and 1D EMA200 need 200 bars, impossible from 15m aggregation alone. Added parallel REST fetch of 250 bars of 4H + 1D candles during warmup, merged with aggregated data. Committed: `95b71cc`.
4. **Added S1/S2/S3 diagnostic logging** — Each strategy logs filter conditions with pass/fail on every evaluation. Committed: `334b47d` (S3), `95b71cc` (S1/S2).
5. **Discord `#tradekit-signals` channel** — All diagnostics + risk manager trade blocks routed to new Discord channel. Color-coded: S1=orange, S2=blue, S3=gold, risk blocks=red. Committed: `31b90a5`, `1813677`.

**Confirmed working:** First S2 diagnostic post-fix showed `BBWP=27.8(ok) PMARP=62.9` — real values, not NaN. Warmup loads 1500 15m + 251 4H + 251 1D bars.

## What Was Done (Session 23) — Fix consecutive-loss infinite pause + dead WebSocket

**Two bugs found and fixed, both deployed to VPS.**

### Bug 1: Consecutive Loss Infinite Pause Loop
Risk manager `canTrade()` checked `consecutiveLosses >= 3` on every call — but the counter only resets on a winning trade. After 4 S3 losses, the bot was permanently stuck: pause 4h → expire → signal arrives → re-pause 4h → repeat forever. Status digest showed "ACTIVE" (pause expired) but no trade could ever open.

**Fix:** Reset `consecutiveLosses` to 0 when the pause is triggered (`resetConsecutiveLosses()` in `state.ts`, called from `manager.ts`). After the 4h cool-off, bot gets a fresh slate. If next 3 trades also lose, cycle repeats correctly.

### Bug 2: WebSocket Dead for 48 Hours
VPS logs confirmed: `[WS] No message in 173525s — reconnecting...` — the heartbeat detected staleness but `reconnect()` silently failed every 30 seconds for 48 hours (5,700+ attempts). No bar closes → no strategy evaluation → no diagnostics → no trades.

**Fix:** Added `MAX_RECONNECT_ATTEMPTS = 10` to `candle-consumer.ts`. After 10 consecutive failed reconnects (~5 min), process exits with code 1 for pm2 to do a clean restart (full REST warmup + fresh WS connection). Counter resets to 0 on any successful message.

### Consultant Review (Session 22 trades)
- 8 trades total, 6 S3, 33% WR, **4.54x risk/reward** — viable edge (break-even at ~18% WR)
- Total PnL +$0.129 on $20 positions at 1x leverage — math works, needs leverage to be meaningful
- S2 correctly blocked by BBWP=88.9 (high-vol regime) — not a bug
- Portfolio stats showed "2 open" but Discord showed 0 — ghost entries in `activePositions[]` from before WS died, reconciliation should auto-clean on next bar close
- S3 consecutive losses suggest need for **daily-scale regime filter** (not just 1H BBWP)

### Flash Regime Filter Analysis
Reviewed `c:\work\flash\trader\src\strategy\regimeFilter.ts` — dual-layer regime detection:
1. Daily EMA (5d/21d/21w) trend detection — pauses grid when trending
2. Rapid momentum detector — pauses on intraday crashes (3+ buys in 60min)
3. Volatility-adaptive grid spacing (low/normal/high tiers)

**Directly applicable to S3:** same problem (mean-reversion in trending market = losses). S3's 1H BBWP is a short-term view; Flash's daily EMA trend overlay would catch multi-day regime shifts. Could also become shared infrastructure for S4 grid strategy.

### Deployment
Committed `9677532`, pushed to main, pulled on VPS, built, pm2 restarted. Bot immediately healthy: warmup 1500+251+251 bars, WS connected, bar closes flowing, S2 diagnostic appeared (`BBWP=88.9(FAIL)`). VPS path: `~/trading-bot`.

---

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-04-27 | VPS bot restarted with Session 23 fixes | Both consecutive-loss fix + WS max-retry deployed. Monitor Discord #tradekit for trades/errors + #tradekit-signals for diagnostics resuming. | `ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98 "pm2 logs trading-bot --lines 30 --nostream"` |
| 2026-04-27 | Ghost position cleanup | Portfolio stats showed "2 open" but Hyperliquid has 0. Reconciliation should auto-clean on next bar close. Verify in Discord or pm2 logs. | Check for `[Bot-VPS] Detected native close` messages in logs |
| 2026-04-14 | Desktop bot needs restart for commit `0155e74` | Running pre-reconciliation code. Low priority — VPS bot is primary. | Ctrl+C PS window → `$env:DRY_RUN="false"; npm start` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Monitor post-restart behavior** | low | Confirm diagnostics flowing in #tradekit-signals, ghost positions cleaned up, WS stays connected. Give it 24h. |
| 2 | **S3 regime filter research** | med | Backtest S3 with daily EMA trend overlay (5d/21d from Flash's `regimeFilter.ts`). S3's 1H BBWP misses multi-day trends — 4 consecutive losses were S3 scalping against a trend. Could share filter infra with S4 grid later. |
| 3 | **Verify Supabase trades_source_check** | low | Colleague ran the SQL fix (2026-04-24). Verify closed trades record correctly after next trade closes. |
| 4 | **Scale up leverage after 10-15 trades** | low | Change `LEVERAGE_MULT=1.0` in VPS `.env` → `pm2 restart trading-bot`. Early stats: 4.54x R:R at 33% WR — viable edge but tiny PnL at 1x. |
| 5 | **S4 Grid strategy research** | med | Build natively on Hyperliquid perps. Backtest grid on 24-month Binance data with funding rates. Port Flash regime filter as shared infra (S3 + S4). See auto-memory for full analysis. |
| 6 | **TradingView indicator validation** | low | Compare local vs TV values. Run `validate_indicators.ts` when TV Desktop available. |
| 7 | **S2 entry tuning** | med | S2 at 40% win rate. Currently blocked by BBWP=88.9 (correct behavior). Revisit when market calms. |
| 8 | **S1 entry loosening** | med | Only ~10 trades/year. Can EMA alignment be relaxed? |
| 9 | **Remove diagnostic logging when stable** | low | Once trading consistently, remove S1/S2/S3 diag sends (or keep signals channel muted). |
| 10 | **New strategy development** | med | Colleague finds setups on TV → writes rules → we code + backtest → deploy. |
