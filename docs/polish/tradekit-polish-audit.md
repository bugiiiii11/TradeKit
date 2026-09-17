# TradeKit -- polish audit (S50, 2026-09-17)

Scope: `src/main-headless.ts` (tick loop by range), `src/strategy/{s1,s2,s6,confluence}.ts`, `src/db/snapshots.ts`,
`src/ws/candle-consumer.ts` (warmup), `src/indicators/calculator.ts` (NaN policy), `frontend/src/app/(app)/market-data/page.tsx`,
`frontend/src/lib/format.ts`, `docs/rein-x-tradekit.md`, `docs/session-archive.md` (backtest result lines only).
Lenses asked: strategy edge / profitability (content-balance), market-data page (screens-flow + backend), reliability, UX.
Evidence given: 4 screenshots. (1) `/market-data` -> "This page couldn't load", Server Components render error, digest
2925642464. (2) `/trades` -> Total PnL -$25.74 over 51 closed, 29% win rate, avg R 0.05, bot trades -$25.66 14W/32L,
most visible rows 8x S6-style exits `ema_reverse_cross` at -0.3 to -0.8R. (3) `/strategies` shows S1/S2/S3 templates,
"0 configs, 0 enabled, No runs yet" each. (4) Dashboard: bot online, vps-bot, S1+S6 enabled, leverage 1x, bankroll $369.54.
Owner statement: "it works fine, but the strategies are not winning strategies."
Everything here is a RECOMMENDATION with an ID; the owner picks, then one sprint per session.

**Constraint (copied into every sprint):** the VPS bot trades REAL money on Hyperliquid mainnet. A bot-side change
means `git pull` + `pm2 restart trading-bot` on the VPS, and handoff row 1 (S48) says: do not restart until the first
post-outage trade has validated the S48 fixes. So every item that touches `src/` bot runtime is Risk M minimum and is
scheduled in its own sprint that the owner opens deliberately. Frontend items deploy through Vercel on push to `main`
and never touch the bot. Strategy research items run backtests locally only (`src/scripts/backtest_*.ts`) and change
no live parameter until the owner flips `ENABLED_STRATEGIES` / env on the VPS.

| Sprint | Session | Items | Automated | Human verdict |
|--------|---------|-------|-----------|---------------|
| -- | S50 | audit written, nothing shipped | -- | picks pending |
| 1 | S50 | A1(a), B1, B2, B3, B4, G1, G2 | tsc 0, eslint 0, next build 0 | **verified S51** on trade-kit.vercel.app (market-data renders; trades date+strategy+scoreboard+toggle; strategies S6 card + LIVE/DISABLED). Shipped only after the Vercel Git reconnect -- the S50 push alone deployed nothing. One defect found and fixed in S51: G2 card sort was inverted (disabled before live). |

Token note -- read fully: market-data page (lines 1-460), s1, s6, confluence (grep), snapshots.ts 15-80, format.ts,
rein-x-tradekit.md. By range: main-headless.ts 295-445 + greps, candle-consumer.ts greps, calculator.ts greps,
s2 greps, trades/strategies pages greps, session-archive backtest lines. Not examined: `orders.ts`, `commands.ts`,
`handlers.ts`, `backtest/engine.ts` internals, `risk/manager.ts`, `automation`/`backtests` pages, `manual-trade-card.tsx`,
the live Supabase `trades` rows (Supabase MCP not authorised this session -- stats taken from screenshot 2).

Effort is relative size, not hours: XS = one edit, S = one sitting, M = a few sittings, L = a sprint.
Risk L/M/H = regression surface (H touches the constraint, a contract, a migration, or needs a build the
assistant cannot run). Cost L/M/H = tokens for the executing session. Win = Value / effort points
(XS 0.5, S 1, M 3, L 6).

---

## 1. Root causes (code-cited)

| ID | Finding | Where | Fix | Value | Effort | Risk | Cost | Visible | Deps |
|----|---------|-------|-----|-------|--------|------|------|---------|------|
| **A1** | **Market-data page crashes because 1D `pmarp`/`bbwp` arrive as `null` and the page calls `.toFixed` on them.** The VPS bot warms up only 250 daily candles (`candle-consumer.ts:126`), but PMARP lookback is 350 and BBWP lookback 252, so the calculator returns `NaN` for the 1D row (`calculator.ts:157,194`). `JSON.stringify` turns `NaN` into `null` on the Supabase insert (`snapshots.ts:55-60`). The page types the fields as `number` and renders `snap.pmarp.toFixed(1)` / `snap.bbwp.toFixed(1)` in the Volatility card for every timeframe including 1D -> TypeError in the Server Component -> the digest error in screenshot 1. Same latent trap on `rsi14`, `stochK`, `stochD` (`page.tsx:386-399,416`). | `frontend/src/app/(app)/market-data/page.tsx:386-399,416,446,455`; `src/ws/candle-consumer.ts:126`; `src/indicators/calculator.ts:141-160,184-196` | (a) Frontend only: add a `num(v, digits)` helper that returns "--" for null/NaN and use it for every indicator readout; widen `IndicatorSnapshot` fields to `number \| null`. Page renders again today with 1D volatility shown as "--". (b) Bot side (own sprint, restart): raise the 1D warmup from 250 to 400 bars so 1D PMARP/BBWP are real numbers. Hyperliquid serves up to 5000 candles per request so one number changes. | 5 | XS (a) / XS (b) | L (a) / M (b) | L | desktop | (b) needs a restart window |
| **A2** | **The headline trade stats measure a strategy set that no longer runs.** 51 closed bot trades are summed across every era: the S3 scalp era (disabled S28, backtest PF 0.51), the S2 era (disabled after S29 26-month backtest showed S2 -$30 / 31% WR), and the current S1+S6 set (handoff: 4 closed trades since the S43 rework, net +$23.71). The trades page has no strategy column, no date (only time of day, `formatTime`), and no "since" filter, so "-$25.74, 29%" reads as the verdict on S1+S6 when it is mostly the verdict on S3. Nobody can currently answer "is the live S1+S6 set tracking its backtest (S6 46% WR / PF 1.6, S1 78% WR)?" from the app. That question is the whole strategy problem, and there is no instrument for it. | `frontend/src/app/(app)/trades/page.tsx:63-64,292-312`; `src/db/trades.ts:48,60-63` (strategy is written inside the JSON metadata, `strategy_config_id` is always null) | Build the instrument: G1 + G2 + B1 + B2 below (per-strategy live table with expectancy, win rate, avg R, trade count, and the backtest reference numbers beside them; date column; "since current config" default filter). | 5 | S (as G1+G2) | L | L | desktop | -- |

Not the cause / checked and fine: the three external fetches on the market-data page (CoinGecko x2, alternative.me)
are each wrapped in try/catch and fall back to `[]`/`null` with an explicit empty-state row (`page.tsx:89-131,248-252`),
so a rate-limited CoinGecko cannot produce the crash. The Supabase query destructures `{ data }` and null-guards the row
(`page.tsx:154-159`), so an empty `market_snapshots` renders the "No bot data yet" card. `formatPrice`/`formatFundingRate`/
`formatRelativeTime` are all null-safe (`format.ts:17-62`). The 1D EMA200 that the S1 macro filter and the confluence
scorer depend on is fine: EMA200 needs 200 bars and 250 are loaded (`calculator.ts:50-51`), and S1 already guards with
`Number.isNaN(snapDaily.ema200)` in its diag line (`s1_ema_trend.ts:60`). The bot itself does not crash on the NaN
because it never formats 1D PMARP/BBWP; only the page does. WS liveness, dead-man cron and the S48 watchdog were not
re-verified here (Watchlist row 1 procedure applies each session, not this audit).

---

## 2. Area G -- strategy edge / profitability (content-balance)

| ID | Finding | Where | Fix | Value | Effort | Risk | Cost | Visible | Deps |
|----|---------|-------|-----|-------|--------|------|------|---------|------|
| **G1** | **No per-strategy live scoreboard.** Strategy lives in `trades.metadata.strategy`, the page groups only bot vs manual. | `trades/page.tsx:63-64`; `src/db/trades.ts:62-63` | Group bot trades by `metadata.strategy`: trades, W/L, win rate, sum PnL, avg R, expectancy per trade, max consecutive losses. Show the backtest reference beside each (S1 78% WR / 9 trades / 429d; S6 46% WR / PF 1.59 / 105 trades; from session-archive S29-S31). A row turning red against its reference is the signal to act. | 5 | S | L | L | desktop | A1(a) pattern for null-safe numbers |
| **G2** | **Era filter.** Stats sum dead-strategy eras with the live set. | `trades/page.tsx:63-64` | Default the stat cards to "since current config" (env-free: first trade whose `metadata.strategy` is S1 or S6 after S3/S2 were disabled; simplest = a `since` query param defaulting to the S43 rework date) with an "all time" toggle. | 4 | S | L | L | desktop | G1 |
| **G3** | **Backtests are in-sample.** S6 lookback=40 was chosen on the same 379-day window it was validated on (archive line 132); S1+S6 "+33%" is the same window. There is no walk-forward or out-of-sample split anywhere in `src/backtest/`, which is the textbook reason a strategy "looks good in backtest, loses live". | `src/scripts/backtest_binance.ts`, `src/backtest/engine.ts` | Add `--train-until <date>` / `--test-from <date>` to `backtest_binance.ts` and report both windows side by side (PnL, PF, WR, max DD, trade count). Rule for every future strategy: parameters chosen on 2024 data, judged on 2025-26 data. Re-run S1, S6, S1+S6 this way first; the result decides whether G4/G5 are worth doing. | 5 | M | L | M | invisible (report) | -- |
| **G4** | **S6 gives back winners on `ema_reverse_cross` in chop.** Screenshot 2: 8 of 16 visible 8x rows exit via `ema_reverse_cross` at -0.26 to -0.81R; the 1H EMA8/55 reverse cross is a lagging exit. S6 exits are the one lever the archive says moved every metric (trailing: Sharpe 2.93 -> 3.91, avg loss -$2.65 -> -$1.95). | `src/strategy/s6_bbwp_breakout.ts:86-110`; `src/scripts/backtest_s6.ts` | A/B in `backtest_s6.ts`, out-of-sample per G3: (a) time stop (exit if not +1R after N 1H bars); (b) exit on BBWP falling back below 50 (breakout failed) instead of waiting for `bbwp_cycle_complete`; (c) trailing-only, no EMA exit; (d) ATR-based stop instead of fixed 2%. Ship only a variant that wins out-of-sample. | 4 | M | L | M | invisible (report) | G3 |
| **G5** | **Regime filter exists but is not applied to S6.** `src/backtest/regime-filter.ts` (Flash 5d/21d daily EMA) removed losers 2.6:1 on S3. S6 fires 105 trades/yr at 46% WR; a chop filter is the obvious next test. | `src/backtest/regime-filter.ts`; `src/scripts/backtest_s6.ts` | A/B S6 with and without the regime filter, out-of-sample per G3. | 3 | S | L | L | invisible | G3 |
| **G6** | **Candidate new trend entries** (S1 fires ~9/yr, too few to compound). Flash doc + archive agree: BTC perps reward trend-following; the alpha is in signals, not strategy types. | new `src/strategy/s8_*.ts` + backtest script | Backtest, in this order, each out-of-sample: (a) 4H Donchian 20-bar breakout with Daily EMA200 filter (classic, few params); (b) S1 with a pullback entry -- after the 4H cross, enter on the first touch of EMA21 instead of at the cross (S2's intent, S1's trend gate); (c) S1 on 1H with a 4H trend gate (more signals, same logic). Only promote a candidate whose out-of-sample PF > 1.3 with > 30 trades. | 4 | L | L | M | invisible | G3 |
| **G7** | **S2 is enabled in code paths but disabled on the VPS; S2 limit entries at EMA55 never fill in trend.** Archive S31: S2 -$30, 31% WR over 26 months. | `src/strategy/s2_mean_reversion.ts`; `main-headless.ts:393-395` | Leave disabled. Either delete S2 from the live strategy list and the Strategies page, or fold its idea into G6(b). Do not re-enable without G3. | 2 | XS | L | L | invisible | -- |

## 3. Area B -- UX

| ID | Finding | Where | Fix | Value | Effort | Risk | Cost | Visible | Deps |
|----|---------|-------|-----|-------|--------|------|------|---------|------|
| **B1** | **Trades "Closed" column shows time of day only.** Rows from June and September look same-day. | `trades/page.tsx:311-312`; `format.ts:64-72` | `formatDateTime` (MMM d, HH:mm) and a title attribute with the ISO string. | 3 | XS | L | L | both | -- |
| **B2** | **No Strategy column in the trades table.** | `trades/page.tsx:292-312` | Add a `Strategy` badge column from `metadata.strategy` (S1 / S6 / S3 / manual). | 4 | XS | L | L | both | -- |
| **B3** | **Strategies page describes S1/S2/S3 with empty stats while the bot runs S1+S6.** Stats join on `strategy_config_id`, which the bot writes as `null` (`trades.ts:48`), so every card says "No runs yet" forever; S6 has no template row. | `strategies/page.tsx:61-65,116-142`; `src/db/trades.ts:48` | Insert an S6 row in `strategy_templates` (SQL, one row), join trades by `metadata.strategy` = template id instead of config id, mark S2/S3 cards "disabled" with the reason from the backtests. | 3 | S | L | L | desktop | B2 |
| **B4** | **Market-data 1D volatility row shows "--" after A1(a)** until A1(b) ships. | `market-data/page.tsx:440-460` | Show a one-line hint "1D BBWP/PMARP need 400 daily bars of history; bot loads 250" until A1(b) is deployed. | 1 | XS | L | L | desktop | A1(a) |

## 4. Area F -- reliability / backend

| ID | Finding | Where | Fix | Value | Effort | Risk | Cost | Visible | Deps |
|----|---------|-------|-----|-------|--------|------|------|---------|------|
| **F1** | **Position is naked if the stop-loss placement fails after a filled entry.** `setStopLoss` is awaited once with no retry and no fallback on both the confluence path and the S6 path; CLAUDE.md already lists this as "NOT IMPLEMENTED". The outer catch logs and moves on with an open, unprotected 8-10x position. | `src/main-headless.ts:400-403,504-507` | Retry `setStopLoss` 3x with 2s backoff; on final failure `closePosition` immediately and post a red Discord alert. Reduce-only exits must never depend on anything else succeeding. | 5 | S | M (live order path, needs restart) | L | invisible | restart window |
| **F2** | **1D warmup too short for the configured lookbacks** (= A1(b)). | `src/ws/candle-consumer.ts:126` | `250 * 24h` -> `400 * 24h`. Verify after restart: startup log shows 1D PMARP as a number; market-data page 1D row populated. | 3 | XS | M (restart) | L | desktop | restart window |
| **F3** | **Leverage default in code (`LEVERAGE_MULT=0.25`) differs from the dashboard (1x).** Harmless if the VPS env sets it, but a fresh checkout trades at a quarter size silently. | `src/main-headless.ts:70,921` | Log the effective multiplier in the startup line (already there) AND in the 2h digest, so a mismatch is visible in Discord. | 2 | XS | M (restart) | L | invisible | restart window |

---

## 5. Suggested order (recommended set; the owner picks)

- **Sprint 1 -- fix the page + build the strategy instrument, frontend only, zero bot risk (5 pt):** A1(a) 0.5, B1 0.5, B2 0.5, G1 1, G2 1, B3 1, B4 0.5. Deploys through Vercel. Verdict: `/market-data` loads; `/trades` shows a per-strategy table with dates and the backtest references; the owner can read "S1+S6 since the rework" as one number.
- **Sprint 2 -- out-of-sample truth (4 pt):** G3 (M) then G5 (S). Backtests only, no live change. Verdict: a table S1 / S6 / S1+S6 / S6+regime, train vs test window. This decides whether the current set has an edge at all before anyone builds a new one.
- **Sprint 3 -- S6 exits (3 pt):** G4 (M), four exit variants out-of-sample. Ship a variant only if it wins on the test window; that is a bot change and moves to Sprint 5.
- **Sprint 4 -- new entry candidates (6 pt):** G6 (L). Only if Sprint 2 showed S1/S6 are marginal; skip if they hold out-of-sample.
- **Sprint 5 -- bot deploy window (2 pt, opened by the owner when a restart is acceptable):** F1 (S), F2/A1(b) (XS), F3 (XS), plus any winner from Sprint 3. One `git pull` + `pm2 restart`, then the Watchlist row-1 liveness check and the hydration check from row 2.
- **Later (listed, unranked):** G7 (delete or fold S2), CoinGecko API key for the prices table (rate-limited without one), leverage decision (handoff row 3, wait for ~10 trades on the instrument from Sprint 1).

**Design picks for the owner (never assumed):** G1 layout -- one compact table under the stat cards vs one card per strategy like the Strategies page. The table is recommended: it is the instrument, not a showcase.
**Risk-H / Cost-H (unpicked by default):** none. All bot-side items are Risk M because of the restart, not because of the code; they are grouped in Sprint 5 so one restart covers them.

## Plan (picked)

Picks (owner, S50): `sprint 1`.

- Sprint 1 -> A1(a) 0.5, B1 0.5, B2 0.5, G1 1, G2 1, B3 1, B4 0.5 = 5 pt. Frontend only; deploys via Vercel on push to `main`.
- Sprints 2-5 -> unchanged from section 5, not yet picked.
- Unpicked (owner): none stated.

---

## 6. Test matrix

Frontend: Chrome desktop (screenshots 1-4 are 1450-1880 px wide) + one phone width (mobile-nav exists), light and dark
theme (theme toggle in header). Check `/market-data` with an empty `market_snapshots` (still renders), with the live
row (1D volatility "--" until F2), and after F2 (numbers). Bot items: VPS only, procedure = Watchlist rows 1-2 in
handoff.md after every restart. Backtest items: `npx ts-node src/scripts/backtest_binance.ts` on the local Binance CSVs
(`data/binance/`, 26 months) -- the Hyperliquid API caps at 52 days and must not be used for these runs.

## 7. Do not

- Do not restart the VPS bot to "fix" the market-data page. The page bug is a frontend null guard (A1a); the bot-side
  warmup change (F2) is a nice-to-have and waits for the deliberate restart window (handoff row 1).
- Do not judge S1+S6 on the -$25.74 headline; it is dominated by the disabled S3 era. Build G1/G2 first, then judge.
- Do not tune S6 (lookback, thresholds) on the full 379-day window again; every future parameter is chosen on the train
  window and reported on the test window (G3), or the result is not evidence.
- Do not re-enable S2 or S3; both are negative over 26 months and the 12-month runs (archive S28, S31).
- Do not read `.env` or the VPS wallet key; leverage and enabled strategies are read from the startup log line
  (`main-headless.ts:921`) and the dashboard, never from the file.
- Do not build a new strategy before Sprint 2 reports; if S1+S6 hold out-of-sample, the win is leverage and patience,
  not a fourth entry signal.
