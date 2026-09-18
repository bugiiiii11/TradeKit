# TradeKit -- polish record

> **S52 correction: every backtest number in this document is inflated.** The multi-TF aligner fed the
> engine the still-forming higher-TF bar (up to 45min/3h45m/23h45m of future data on 1H/4H/1D) until
> commit `71d3422`. Sprint 2's headline "PF 1.99 out-of-sample" is PF 1.03 corrected. Re-run and
> re-decisions: `docs/polish/s52-corrected-matrix.md`.

Audit: `docs/polish/tradekit-polish-audit.md`. One section per shipped sprint, appended in order.
Constraint (every sprint): the VPS bot trades real money; bot-side changes need a deliberate restart
window (handoff row 1). Frontend never touches the bot. **Correction (S51): Vercel does NOT auto-deploy
on push to `main`** — the project has no connected Git repo, so Sprint 1 sat pushed-but-undeployed for
the whole S50->S51 gap and the live site still served a 27-day-old build. Shipping needs an explicit
`npx vercel --prod`, or the GitHub connection repaired in the Vercel dashboard.

## Measuring guide -- the strategy instrument

`/trades` now defaults to the window since the current S1+S6 configuration (2026-06-01, first S6
bot trade, Session 43). The "Strategy Scoreboard" card is the instrument:

- One row per strategy found in `trades.entry_conditions.strategy`, bot trades only.
- Columns: trades, W/L, win rate, PnL, avg R, expectancy per trade, profit factor, max consecutive
  losses, and the backtest reference (Session 29-31, 26-month Binance, 1.0x).
- Win rate turns red when a strategy has >= 10 live trades and sits more than 10 points under its
  backtest reference. That is the "act" signal; under 10 trades the column is not evidence yet.
- "All time" toggle (top right, or `/trades?since=all`) restores the previous behaviour;
  `/trades?since=YYYY-MM-DD` sets any window.

Read it once per session and copy the S1 and S6 rows into the handoff Watchlist balance row.

---

## Sprint 1 -- S50 (2026-09-17) -- market-data fix + strategy instrument (frontend only)

### What changed (by ID)

- **A1(a)** `frontend/src/app/(app)/market-data/page.tsx`: `IndicatorSnapshot` fields are
  `number | null` (type `Ind`); every readout goes through `num()` from `format.ts`; the
  Macro Filter card, the 15m StochRSI sentence, the Daily RSI sentence, the S2 BBWP sentence, the
  4H EMA sentence and `EmaAlignment` are null-guarded; colour/label helpers accept null.
  The S1 macro logic on the bot is untouched.
- **B4** same file, Volatility card: a one-line hint appears when 1D BBWP/PMARP are null
  ("bot loads 250 daily bars; 252/350 needed").
- **B1** `frontend/src/lib/format.ts`: new `formatDateTime()` (Mon DD HH:mm UTC) and `num()`.
  `trades/page.tsx` Closed column uses it, with the ISO string as tooltip.
- **B2** `trades/page.tsx`: Strategy badge column on the bot table (filled = live S1/S6,
  outline = S2/S3/unknown), read from `entry_conditions.strategy`.
- **G1** `trades/page.tsx`: Strategy Scoreboard card (see measuring guide). `computeStats` gained
  expectancy, profit factor and max consecutive losses; the loss streak walks trades oldest to newest.
- **G2** `trades/page.tsx`: `since` search param, default `CURRENT_CONFIG_SINCE = "2026-06-01"`,
  toggle in the header; stat cards say how many older rows are hidden. Query limit raised 100 -> 1000.
- **B3** `frontend/src/app/(app)/strategies/page.tsx`: stats joined on
  `entry_conditions.strategy` instead of the always-null `strategy_config_id`; S6 rendered from an
  in-page fallback template when `strategy_templates` has no `s6` row; LIVE / DISABLED badge per card
  with the backtest reason; live strategies sort first; grid is 2 / 4 columns.

### Verified -- automated

```
cd frontend
npx tsc --noEmit -p .        -> exit 0
npx eslint <4 touched files> -> exit 0
npx next build               -> Compiled successfully, all 8 routes, exit 0
```

No browser smoke: every page sits behind the login proxy and no test credentials are available to the
assistant. Vercel preview + the checklist below is the verification.

### Checks that need a human (after a Vercel deploy actually lands -- a push alone is NOT enough, see the S51 correction above)

1. `/market-data` loads (no "This page couldn't load"). Volatility card: 15m/1H/4H rows have numbers,
   1D row shows "—" twice plus the grey hint line. Momentum card: four rows with numbers.
2. `/trades`: header shows the "Since current config (2026-06-01)" toggle active. Total PnL card hint
   reads "N closed · M older hidden". Scoreboard shows S6 and S1 rows; S6 win rate is NOT red unless
   it has >= 10 trades and < 36%. Closed column shows "Jun 01 08:30 UTC"-style values. Strategy column
   present. Click "All time": the old -$25.74 / 51 closed numbers come back and S3 rows appear.
3. `/strategies`: four cards, S1 and S6 first with LIVE badges, S2/S3 dimmed with DISABLED and the
   reason. S6 card shows Trades / Win Rate / PnL from live data (not "No runs yet").
4. Dark and light theme once each; one phone width for `/trades` (tables scroll horizontally).

### Optional DB step (not required, the page works without it)

Insert the S6 template row so the fallback is no longer needed and a future config editor sees it:

```sql
insert into strategy_templates (id, name, description, param_schema) values (
  's6', 'BBWP Volatility Breakout',
  '1H BBWP crosses above 50 after compression (<20 within 40 bars); direction from price vs EMA21; 2% stop; exit on EMA8/55 reverse cross or BBWP cycle complete.',
  '{"groups":{"risk":["stop_distance_pct","default_leverage"],"timeframes":["primary_tf"],"entry":["compression_threshold","expansion_threshold","compression_lookback"]},"properties":{"stop_distance_pct":{"type":"number","default":0.02},"default_leverage":{"type":"number","default":8},"primary_tf":{"type":"string","default":"1H"},"compression_threshold":{"type":"number","default":20},"expansion_threshold":{"type":"number","default":50},"compression_lookback":{"type":"number","default":40}}}'
) on conflict (id) do nothing;
```

### Tooling gotchas

- A bash heredoc containing an apostrophe inside a Python triple-quoted string broke the Git Bash
  parser on this machine; write patch scripts to the scratchpad with the Write tool and run them.
- `grep -r` from the repo root walks `frontend/node_modules` and times out; use `rg` with
  `--glob '!node_modules'`.
- Supabase MCP is not authorised in this session, so live row shapes were inferred from
  `src/db/trades.ts` / `snapshots.ts`, not read from the DB.

### Not in this sprint (remaining picks)

Sprints 2-5 as listed in the audit: G3 walk-forward split, G5 regime A/B, G4 S6 exit variants,
G6 new entries, then the bot deploy window (F1 stop-loss retry, F2 1D warmup 250 -> 400, F3 digest
leverage line). Sprint 2 shipped S51 (below); G4/G6 and the bot window remain unpicked.

---

## Sprint 2 (S51) -- out-of-sample truth: G3 + G5

Backtests only. No bot change, no live change.

### What shipped

- `src/backtest/types.ts` -- `regimeFilterStrategies` (default `["S3"]`) and `regimeBlockWhen`
  (`"trending"` default | `"sideways"`). Defaults preserve every archived S3 regime number.
- `src/backtest/engine.ts` -- regime gate generalised off the hardcoded `"S3"`, AND repeated on
  the S6 independent-entry path.
- `src/scripts/backtest_binance.ts` -- `--train-until` / `--test-from` (the literal G3 ask).
- `src/scripts/backtest_oos.ts` -- NEW. Loads once, splits, replays the 5-config matrix on both
  windows, prints train/test side by side plus a verdict gate.

### Two bugs found while running it (both would have produced fake results)

1. **The regime filter never applied to S6.** S6 bypasses the confluence scorer and enters via an
   independent path at `engine.ts:477`, which never reaches the gate in the confluence block. First
   run returned "S6 + regime" byte-identical to "S6 only". **Property to remember: any filter added
   to the confluence block silently no-ops on S6.**
2. **The train window collapsed to 148 days.** `aligner.ts:72` requires a warm *daily* PMARP, which
   needs ~370 daily bars, so ~1 year of any download is eaten as warmup. 31 months downloaded gave
   19 usable. Fixed by downloading 55 months (`--months=55`, Feb 2022 ->), giving an 878-day train.

### Result (bankroll $500/window, margin 5%, cut 2025-07-01)

TEST, out-of-sample 2025-07-01 -> 2026-09-17 (444d):

| Config | Trades | WR | PnL | PF | MaxDD | Sharpe |
|---|---|---|---|---|---|---|
| S1 only | 13 | 69% | +$61.29 | 6.60 | 2.0% | 7.77 |
| S6 only | 190 | 47% | +$243.04 | 1.85 | 5.7% | 3.17 |
| **S1 + S6 (live set)** | **182** | **49%** | **+$265.74** | **1.99** | **5.8%** | **3.52** |
| S6 + regime (block chop) | 32 | 69% | +$169.58 | 7.28 | 1.9% | 7.80 |
| S1 + S6 + regime on S6 | 38 | 71% | +$226.81 | 8.33 | 2.0% | 8.05 |

Train (878d) for the decay check: S6 only PF 2.36, S1+S6 PF 2.33, S6+regime PF 6.50.

**Verdict: the live S1+S6 set holds up out-of-sample** -- PF 1.99 on 182 trades, mild decay from
2.33, which is what a real edge looks like.

### Caveats that must travel with these numbers

- **The test window is NOT clean for S6.** S6's `lookback=40` was chosen on a 379-day window that
  overlaps this test window. The split fixes the method going forward; it cannot un-see that. S1 is
  clean in this sense, S6 is not. A truly clean S6 verdict needs the parameter re-chosen on train only.
- **The regime-filter rows are not shippable.** PF 8.33 / Sharpe 8.05 on 38 trades are backtest
  artifacts, not production figures. It cuts trades 79% (182 -> 38) to earn $39 LESS. Do not enable.
- **Live divergence is the real open question.** Backtest S6 = 47-50% WR at ~156 trades/yr; live S6 =
  32% WR at ~75 trades/yr over 22 trades. The backtest is modelling something the bot is not doing
  (entry timing, fills, slippage). Chase this before trusting any backtest PF as a live forecast.
- S6-only train MaxDD 15.3% would trip the 15% weekly-drawdown 48h pause.
- S1 alone stays statistically useless out-of-sample: 13 trades.

---

## Do not (cumulative)

- Do not restart the VPS bot for anything in Sprint 1; nothing here runs on it.
- Do not judge S1+S6 on the "All time" numbers; the default window exists for that reason.
- Do not change `CURRENT_CONFIG_SINCE` without also changing the Strategies page status table and
  the handoff Watchlist; the three must describe the same configuration.
