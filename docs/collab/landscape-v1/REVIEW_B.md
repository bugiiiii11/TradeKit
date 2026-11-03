# REVIEW_B -- our own numbers (Landscape Campaign v1, seat B, Round 1)

Measured 2026-11-03 07:25-07:40 UTC from the desktop (ssh key present). Exchange and VPS touched read-only.
Sources: Hyperliquid `info` API (VPS master `0x5642…4110`), Supabase (`trades`, `bot_logs`, `market_snapshots`,
`backtest_runs`), OCI2 shell reads, local Binance CSVs. Throwaway scripts in `docs/collab/landscape-v1/scripts/B/`:
`hl_dump.ts` (fills/funding/ledger/book/candles), `sb_discover.ts`, `sb_logs.ts`, `sb_trades.ts`, `sb_orders.ts`,
`sb_sources.ts` (Supabase pulls), `bt_window.ts` (non-persisting backtest replay of the live window), `analyze.py`
(all joins and statistics). Nothing committed. One Supabase `backtest_runs` row was persisted by the brief's
`--from/--to` command (tagged below). Binance CSVs were downloaded to the session scratchpad, not to `data/bt-data/`.

Windows used: **W1** = since 2026-08-20 (restart); **W2** = since 2026-09-23; **DEAD** = 2026-10-18 09:45 UTC,
the first `User or API Wallet … does not exist` error, after which no exchange action from the VPS has succeeded.

---

## 1. Verdict

The live set is worth less than flat: since the 2026-08-20 restart the VPS bot closed 28 round trips for
**-$30.09 net (-7.9% of the $381.56 start balance), PF 0.24, win rate 18%** (fills, `analyze.py`, W1), and S6 is 26
of those 28 trades. The loss is the strategy's, not the plumbing's: the backtester reproduces the corrected
out-of-sample numbers to the cent today (191 trades, +$8.88, PF 1.03), and replayed on the *live* window it loses
the same way (-$33.53 on 33 trades, PF 0.36; 20 of 28 live entries have a same-direction backtest twin within 4h).
Costs are a rounding error (taker 4.32 bps on every fill, fees 7.8% of |gross|, entry slippage +0.24 bps, stop
slippage +1.65 bps, 4.5 s from bar close to fill). Capacity is not a constraint at any bankroll we can imagine
(our $151 notional is 0.03% of the top-of-book level; S6 can size down to a $25 account). Participation is poor
where it matters: of 31 episodes with a >3% 24h BTC move, the bot was flat in 11 including the two largest
(+11.7% on 08-20..22, +6.7% on 09-18..19), and the trades that did overlap big moves netted -$21.07. Separately,
**the pipeline has been unable to trade since 2026-10-18 09:45 UTC**: 16 S6 signals and 4 web-UI manual trades
since then produced zero orders; the last open position was closed by the exchange-native stop, not by the bot.
The data we already hold can support: (a) multi-asset backtests of S1 (Binance 15m for ETH/SOL is available back
to 2022-02; the code is BTC-hardcoded in five backtest files, ~4-6h), (b) a paper-execution ledger (signal lines
and the bot's own close prices are already logged, so paper P&L can be reconstructed), and (c) nothing cascade-
related yet (955 usable heartbeats, all `medium`, all `ethereum`, `high` never seen). **flips if:** a corrected
S6-only replay on a fresh window after 2026-10-31 with >=100 trades shows PF >= 1.2 (backtest measurement), or the
live S1 sample reaches 20 trades at PF > 1.3 (live measurement, years away at ~9 trades/yr).

---

## 2. Candidate table

| id | candidate | what our data says (number + window) | needs | disposition | flips if |
|----|-----------|--------------------------------------|-------|-------------|----------|
| B1 | **S6 BBWP breakout (live)** | Live W1: n=26, PF 0.26, -$27.47, WR 19%, avg hold 19.4h; W2: n=13, PF 0.14, -$18.18. Same-window backtest: n=32, -$31.75, PF 0.38. Extended corrected OOS 2025-07-01..2026-10-31: S6-only PF 0.94, -$21.52 (219 trades) -- the 44 days after 09-17 took it from +$3.27 to -$21.52. | nothing; a decision | **KILL-CANDIDATE** | S6-only OOS PF >= 1.2 on >=100 trades in a window the parameters never saw |
| B2 | **S1 EMA trend (live)** | Live: n=1 (-$2.61, 09-14..15). Corrected OOS 2025-07..2026-10: 13 trades, +$12.62, PF 1.30, DD 5.9%. Inside the S1+S6 set only 7 of those 13 S1 trades happen (S6 occupies the single position slot). | more samples (see B7), or S1-only live | **WATCH** (keep, unproven) | 20 live S1 trades at PF < 1.0, or S1 OOS on 2+ other assets PF < 1.0 |
| B3 | **Restore exchange access on the VPS** | 0 of 16 S6 signals executed 2026-10-19..11-02; 4 manual trades failed 2026-10-20 17:16-19:11; 4 trailing-SL modifies failed 10-18 19:45-20:45; the bot's own exit at 10-18 09:45 failed and the native stop closed it 15h later at a $0.62 worse price. Dead-man and WS loop report healthy throughout (7,195 bar closes logged). | Matt + VPS `.env`; a health check that exercises the exchange write path | **BUILD** | the owner intends the bot to be signal-only (then: say so and stop the Discord/UI claiming LIVE) |
| B4 | **Paper-execution ledger (signals -> paper fills, no orders)** | Since DEAD we have 16 signals but no P&L for them; before DEAD, `s6-diag` SIGNAL lines + `market_snapshots.price` reconstruct every live entry to within 0.34 bps (entry fill vs snapshot close, n=28). 52 S6 SIGNAL lines were logged since 08-20 (26 traded, 7 blocked by an open position, 16 post-DEAD, 3 other); a paper ledger would have given n=52 instead of 26 for S6 by now. | ~4-6h code in `main-headless.ts` (paper branch) + a `paper_trades` table | **BUILD** | the owner will never run a strategy without real money behind it (then B4 is just the backtester) |
| B5 | **S1-only live (drop S6)** | S6 contributes 26 of 28 trades and -$27.47 of -$30.09. S1-only OOS is the only positive config in both windows. Cost of switching: an env var. Cost of waiting: ~9 S1 trades/yr. | `ENABLED_STRATEGIES=S1` on the VPS; B3 first | **EVALUATE** | B1 flips, or S1 misses the next two confirmed 4H crosses |
| B6 | **Multi-asset backtest (ETH, SOL) for S1/S6** | Binance Vision `ETHUSDT`/`SOLUSDT` 15m monthly zips return HTTP 200 for 2022-02 and 2026-09 (checked 07:38Z). Hyperliquid `candleSnapshot` serves only the newest 5,000 candles (15m back to 2026-09-12, 1h to 2026-04-08, 4h to 2024-07-23) -- useless for history, so Binance stays the source. BTC is hardcoded in `collector.ts:73`, `binance-loader.ts:88,92`, `download_binance.ts:18,46,47,104,115`, `download_funding.ts:14,44`. | ~4-6h; ETH/SOL funding CSVs | **EVALUATE** | S1 on ETH and SOL both PF < 1.0 OOS (then S1 on BTC is a 13-trade fluke) |
| B7 | **Cascade (S5) as a strategy** | 955 new-format heartbeats 2026-09-24 06:47 -> 11-03 06:59 (41 days, hourly, median gap 60.6 min): severity 955x `medium`, chains 955x `ethereum`; `impact` median $0.08M, max $1.28M, 15 >= $1M, 0 >= $10M; `debt` $75-134M; `imminent` 9-14. No `high`/`critical` ever. Exploratory in-sample look: top-decile-by-debt (n=97 overlapping hourly samples) 24h forward -0.93% vs -0.12% for the rest -- a handful of autocorrelated days, not evidence. | a real `high` from the sibling project; >=30 independent episodes | **MONITOR** | first `high`/`critical` arrives, or 6 months of heartbeats contain >=30 non-overlapping debt spikes |
| B8 | **Scale bankroll 2x/5x/10x as a lever** | Fee rate and slippage are size-invariant here: $151 avg notional vs 6.9 BTC ($0.53M) at the best bid, 31.9 BTC ($2.45M) in the top 10 (l2Book 07:26:43Z). At 10x bankroll ($3,650) S1 notional is 0.024 BTC = 0.3% of the top level. Scaling multiplies -$1.08/trade. | an edge | **CLOSED** | B1 or B2 produces a positive live expectancy |
| B9 | **Fee tier / maker entries** | Effective taker 4.32 bps on 65/65 fills (0.045% x 0.96 referral discount); maker would be 1.44 bps. Saving = ~2.9 bps/side = $0.09/trade = $2.5 over W1. Fees are 36% of gross wins but only 7.8% of |gross|; funding net +$0.01 over 110 hours in position. | nothing | **CLOSED** (measured, fine) | volume x100 (VIP tier at $5M/14d) |
| B10 | **Slippage / latency** | Entry vs bot mark px: mean +0.24 bps, median 0.0, max +6.4 (n=28); vs HL 15m close of the trigger bar: +0.05 bps (n=17); entry fill 4.5 s after bar boundary (max 8.7 s); bot exits -0.16 bps; stop fills +1.65 bps mean, max +5.4 (n=10). Total $ cost of entry slippage W1: $0.10. | nothing | **CLOSED** (measured, fine) | notional > ~$50k (then the book matters) |
| B11 | **Supabase `trades` as the P&L record** | 27 Supabase rows vs 28 fill round trips (09-11 13:30 S6 long, +$0.13 gross, is missing). `pnl_usd` is mark-based and gross of fees/funding: -$26.68 vs fills net -$30.09 (dashboard overstates by $3.41 = fees + funding + one trade). Balance walk reconciles to fills: $381.56 -> $364.15 = -$17.41 vs fills net (bot -$30.09 + manual +$12.65) = -$17.44. | fills-based reconciliation job (fits inside B4) | **MONITOR** | fold into B4; otherwise leave |
| B12 | **S3 / S2 / S4-grid / S7 / S6-regime** | Confirmed dead again on the extended OOS (S3 PF 0.48 on 926; S6+regime PF 0.82; S2 PF 1.17 but inverts; S7 not re-run). Nothing new. | -- | **CLOSED** | -- |

Counts: BUILD 2 (B3, B4), EVALUATE 2 (B5, B6), MONITOR 2, CLOSED 4, KILL-CANDIDATE 1, WATCH 1.

---

## 3. BUILD and EVALUATE rows expanded

### B3 BUILD -- restore exchange access on the VPS (ops, not strategy)
- **Scoped first step:** Matt regenerates/approves the VPS agent wallet, updates the VPS `.env` only, restarts
  pm2 id 5, then runs `test_connection.ts` and one `$20 test_micro_trade.ts` from the box. Add a startup and
  4-hourly `exchange write-path probe` (e.g. `userFees` plus a `modify` of a resting far-away order, or simply
  retry-and-alert on the first `does not exist`): today the error is logged at `info` level under source
  `bot-vps`, the Discord digest keeps saying ACTIVE, and the dead-man only watches bar closes.
- **Pass/fail gate:** one live S6/S1 entry with `[Orders] Market …` + `Stop-loss set` logged and visible in
  `userFillsByTime` within 10 s of a bar close. Fail = any `ApiRequestError` on the next 3 signals.
- **Cost:** ~1h of Matt's time, $0.02 in test fees.
- **What we learn on failure:** the key rotation story in the commit log is incomplete (the old agent was revoked
  before the VPS copy was updated, or a new agent was never approved on-chain) -- the "revoke last" rule in
  CLAUDE.md was not followed and needs a checklist, not a sentence.

### B4 BUILD -- paper-execution ledger
- **Scoped first step:** in `main-headless.ts`, when a strategy signal passes the risk gate, also write a
  `paper_trades` row (entry = snapshot close, fixed stop, same exit rules, same fee/funding model as the engine),
  independent of whether the real order succeeds. Backfill from `s6-diag`/`s1-diag` SIGNAL lines +
  `market_snapshots` since 2026-08-20 (52 S6 SIGNAL lines and 7 S1 cross lines exist).
- **Pass/fail gate:** on the 28 overlapping live trips, paper net within ±$0.30/trade of fills net (slippage
  measured at 0.24 bps says it should be within ±$0.05). Fail = systematic sign difference on >3 trades.
- **Cost:** 4-6h; zero exchange risk.
- **What we learn on failure:** the backtester's exit model (bar high/low stops, close-of-bar exits) does not match
  live trailing exits -- which would also invalidate every live-vs-backtest comparison in this review.

### B5 EVALUATE -- S1-only live
- **Scoped first step:** after B3, set `ENABLED_STRATEGIES=S1` on the VPS; keep `s6-diag` logging so S6 keeps
  producing paper signals (B4).
- **Pass/fail gate:** none reachable on a useful timescale -- S1 fires ~9x/yr. The gate is on the *decision*: if
  B1 stays KILL and B6 does not rescue S6, S1-only is the default, not a hypothesis. Measure: live S1 trades vs
  the backtester's S1 entries over the same window (should match 1:1, as 2026-09-14 17:30 did).
- **Cost:** one env var; opportunity cost is S6's expectancy, measured negative.
- **What we learn on failure:** if S1 live diverges from the backtester's S1 (missed crosses, double entries),
  the 4H aggregation on the live buffer differs from the Binance-based aggregator.

### B6 EVALUATE -- multi-asset backtest (ETH, SOL)
- **Scoped first step:** parametrise `download_binance.ts`, `binance-loader.ts`, `download_funding.ts`,
  `collector.ts` by symbol (one `--symbol` flag, filename prefix, Binance REST symbol); run `backtest_oos.ts`
  for ETH and SOL with the same train/test split (train to 2025-06-30, test 2025-07-01..2026-10-31).
- **Pass/fail gate:** S1 test-window PF >= 1.2 on both ETH and SOL with n >= 10 each, and S1 train-window PF >= 1.2
  on both. Fail on either asset = S1's BTC result is not a property of the rule.
- **Cost:** 4-6h code + ~5 min downloads (ETH/SOL monthly zips are ~160 KB each) + ~10 min replay per asset.
  Funding: Binance `fapi` has ETHUSDT/SOLUSDT funding; the loader is a CSV, so the same download script works.
- **What we learn on failure:** S1 on BTC (13 OOS trades) is undersampled noise, and the whole "S1 is the one
  that works" line should be dropped before anyone runs it live alone.

---

## 4. Measurement table (axes 1-5, 8)

| axis | quantity | command / script | number | window |
|------|----------|------------------|--------|--------|
| 1 | bot round trips (from fills) | `hl_dump.ts` -> `analyze.py` | 28 (26 S6, 1 S1, 1 unmatched-S6); +1 manual | W1 |
| 1 | net after fees+funding, all bot | `analyze.py` | -$30.09 (-7.89% of $381.56) | W1 |
| 1 | PF / WR / avg win / avg loss, all bot | `analyze.py` | 0.24 / 18% / +$1.90 / -$1.72 | W1 |
| 1 | S6: n / PF / net / WR / avg hold / long vs short | `analyze.py` | 26 / 0.26 / -$27.47 / 19% / 19.4h / long 12 (-$7.66), short 14 (-$19.81) | W1 |
| 1 | S1: n / net | `analyze.py` | 1 / -$2.61 (native_sl after 7.5h) | W1 |
| 1 | all bot: n / PF / net / WR / maxDD | `analyze.py` | 13 / 0.14 / -$18.18 / 15% / -$20.82 (-5.4%) | W2 |
| 1 | max drawdown (cumulative net) | `analyze.py` | -$30.09 (-7.9%) -- the whole window is one drawdown | W1 |
| 1 | exit-reason mix | `analyze.py` | ema_reverse_cross 12, native_sl 10, bbwp_cycle_complete 3, native_tp 2 | W1 |
| 1 | balance walk vs fills | `sb_sources.ts`, `analyze.py` | $381.56 (08-20 00:16) -> $364.15 (11-02 17:30) = -$17.41; fills net -$17.44 | W1 |
| 1 | corrected OOS expectancy vs live mean | `backtest_binance.ts --from 2025-07-01 --to 2026-09-18`, `analyze.py` | +$0.035/trade expected at $151 notional vs live -$1.075 ± 0.33 (SE), t = -3.4 | W1 vs 444d |
| 1 | same-window backtest (no persist) | `bt_window.ts --from 2026-08-20 --to 2026-11-01 --bankroll 381.56` | S1+S6: 33 trades, -$33.53, PF 0.36; S6-only 32, -$31.75; S1-only 1, -$1.93; 20/28 live entries matched ±4h | live window |
| 1 | corrected OOS, extended to data end | `backtest_oos.ts --data-dir <scratch>` | test 2025-07-01..2026-10-31 (488d): S1+S6 PF 0.96 -$16.19 (212); S6 PF 0.94 -$21.52 (219); S1 PF 1.30 +$12.62 (13); S2 PF 1.17 +$14.39 (75); S3 PF 0.48 -$98.04 (926) | 488d |
| 2 | taker fee rate (fee/notional) | `analyze.py` | 4.32 bps on 65/65 fills, all `crossed=true`, all USDC | W1 |
| 2 | fee tier | `curl userFees` 07:25Z | cross 0.045% / add 0.015%, referral discount 4%, no staking, 14d volume $0 | now |
| 2 | funding paid / received / net | `analyze.py` | -$0.380 / +$0.391 / +$0.011 over 110 position-hours; +$0.003 per trip | W1 |
| 2 | fees total / share of |gross| / share of gross wins | `analyze.py` | $3.67 / 7.8% / 35.6% | W1 |
| 2 | fees+funding per side-equivalent | `analyze.py` | 4.23 bps of notional turnover | W1 |
| 3 | entry slippage vs bot mark px | `sb_orders.ts`, `analyze.py` | mean +0.24 bps, median 0.00, p90 +2.9, max +6.4, min -3.1 (n=28); $0.10 total | W1 |
| 3 | entry fill vs HL 15m close of trigger bar | `analyze.py` (`c15.json`) | mean +0.05 bps, median 0.00 (n=17) | 09-12.. |
| 3 | bar close -> entry fill | `analyze.py` | mean 4.5 s, median 4.1, max 8.7 (n=28) | W1 |
| 3 | bar close -> bot exit fill | `analyze.py` | mean 5.2 s, max 8.6 (n=15); exit slippage -0.16 bps (n=18) | W1 |
| 3 | stop fill vs last trigger | `sb_orders.ts`, `analyze.py` | mean +1.65 bps, median +1.35, max +5.4 (n=10); $0.25 total | W1 |
| 3 | trailing-stop modifications | `sb_orders.ts` | 127 `Stop-loss modified` + 23 `set` over 28 trips; 4 failed (all post-DEAD) | W1 |
| 4 | time in position | `analyze.py` | 28.4% of 1,807h (35.0% until DEAD); 22.8% in W2 (34.6% until DEAD) | W1/W2 |
| 4 | >3% 24h episodes: flat / aligned / against | `analyze.py` (HL 1h closes) | 31 episodes; flat 11; overlapping trades aligned 14, against 13; overlapping net -$21.07 | W1 |
| 4 | largest moves and position | `analyze.py` | +11.7% (08-20..22) FLAT; +6.7% (09-18..19) FLAT; +7.3% (09-21..22) short -$2.71 then long +$2.82; -5.2% (10-30) FLAT, post-DEAD | W1 |
| 4 | signals with no order after DEAD | `sb_logs.ts` | 16 S6 signals 10-19 16:00 -> 11-02 15:30; 4 manual_trade commands 10-20; all `does not exist` | DEAD.. |
| 5 | BTC max leverage / szDecimals | `curl meta` | 40x / 5 (0.00001 BTC = $0.77 at $76,765) | now |
| 5 | book depth | `curl l2Book` 07:26:43Z | best bid 76764 x 6.90 BTC, best ask 76765 x 7.22 BTC, spread 0.13 bps; top-10 bids 31.9 BTC ($2.45M), top-10 asks 16.0 BTC ($1.23M) | now |
| 5 | account | `curl clearinghouseState` 07:25Z | $103.15, no positions, no open orders; withdrawal $260 at 2026-11-02 17:44:24Z (ledger `send`, fee $1.00, hash `0x683587fbe7e9…`) | now |
| 8 | OCI2 memory | `ssh free -m` | 11,927 MB total, 1,872 used, 10,055 available; trading-bot RSS 346 MB (2.9%), HWM 368 MB | 07:25Z |
| 8 | OCI2 CPU | `ssh ps -o etimes,times` | trading-bot 1,409 s CPU over 3,460,980 s uptime = 0.04% of one core; load avg 1.70/1.16/0.96 on 2 cores, 37% of it is Flash's suilend liquidator | 07:25Z |
| 8 | OCI2 disk | `ssh df -h` | 8.7G / 45G (20%); repo 143M; `~/.pm2/logs` 1.5M; out log ~24 KB/day, 30 rotations kept | 07:25Z |
| 8 | restarts vs uptime | `ssh pm2 describe 5` | ↺ 47 lifetime, 0 unstable, uptime 40d since 2026-09-24 06:10:55Z; box up 207d | now |
| 8 | bar-close completeness | `sb_logs.ts` | 7,195 of 7,227 expected `Bar closed` rows (99.6%); snapshots show 18 missing bars in 16 single-bar gaps, 11 of them 09-10..09-12 | W1 |
| 8 | WS reconnects | `sb_logs.ts` | 10 episodes, all 08:18-09:36 UTC on Sat/Sun, each recovered in 1-4 min (502 from the HL REST edge, then subscribe timeout) | W1 |
| 8 | dead-man cron | `ssh grep deadman.log` | 7,095 `ok`, 47 `Gateway Timeout`, 3 `STALE` alerts (09-11 21:15, 09-13 10:15, 10:30); cron rows: 5 (ours every 15 min; 4 Flash) | 08-20.. |
| 8 | RTT to api.hyperliquid.xyz | `ssh curl -w` x5 + x3 | TCP connect 3 ms, TLS 32 ms, total 174-305 ms (`meta`), 163-169 ms (`l2Book`) | 07:25Z |
| 8 | command channel | `sb_orders.ts` | 75,193 `Resubscribing` rows 08-22 21:39 -> 09-24 (every 30 s, 30 days); after the 09-24 deploy: 2 genuine backoffs (09-27, 10-25) | W1 |

---

## 5. Cascade section (axis 6)

Data-quality rule respected: only heartbeats logged with the full-precision format (`debt=` present), i.e. from
the 2026-09-24 06:10 deploy. 2,714 older `impact=$0M` rows excluded.

- **Count / cadence:** 955 heartbeats, 2026-09-24 06:47 -> 2026-11-03 06:59 (41 days). Median gap 60.6 min, p90 61,
  max 63 -- an hourly cron, not an event stream. 9 other webhook rows (rejections/health) in the period.
- **Severity / chains:** `medium` 955 / 955; `ethereum` 955 / 955. `high` and `critical`: 0 ever (confirms prior).
- **`estimated_impact_usd`:** min $0, p25 $0.01M, median $0.08M, p75 $0.12M, p90 $0.25M, max $1.28M; 818 non-zero,
  only 31 distinct values.
- **`aggregate_debt_usd`:** min $75.2M, median $98.7M, p90 $111.3M, max $134.5M; 692 distinct values (it drifts).
- **`imminent`:** 9-14, median 12, 6 distinct values.
- **"Large" by any plausible definition:** impact >= $1M: 15; >= $10M: 0; debt >= $200M: 0; imminent >= 20: 0;
  severity above medium: 0. Distinct (impact, debt rounded to $1M, imminent) tuples: 140 of 955 -- most hours
  repeat the previous hour.
- **Exploratory forward look (IN-SAMPLE, overlapping hourly samples, not a test):** BTC return after the top-decile
  heartbeats vs the rest, HL 1h closes:

  | ranked by | n top / rest | +1h top / rest | +4h top / rest | +24h top / rest | 24h %down top / rest |
  |---|---|---|---|---|---|
  | impact >= $0.25M | 101 / 854 | -0.005% / -0.008% | -0.063% / -0.026% | -0.361% / -0.186% | 55% / 49% |
  | debt >= $111.3M | 97 / 858 | -0.033% / -0.005% | -0.198% / -0.011% | -0.932% / -0.120% | 78% / 46% |
  | imminent >= 12 | 501 / 454 | -0.006% / -0.010% | -0.030% / -0.030% | -0.179% / -0.235% | 50% / 50% |

  Unconditional 24h return over the same hours: -0.205%, sd 1.35%. The debt-decile row looks like something, but
  97 consecutive-hour samples are perhaps 5-8 independent episodes inside a 41-day window in which BTC fell; the
  same look on `imminent` shows nothing. **What the data can support:** that the feed is alive, hourly, static-ish,
  and has never emitted the severity S5 keys on (`MIN_SEVERITY = "high"`). **What it cannot support:** any
  threshold, any direction claim, any expectancy. Not proposing one.

---

## 6. Capacity section (axis 5)

Arithmetic from `src/risk/sizing.ts` (`calcMarginBasedSize`: margin = 5% of balance, notional = margin x
leverage), `main-headless.ts` (S1 10x, S6 8x, `LEVERAGE_MULT` 1.0 on the VPS per the logged 8x/10x), Hyperliquid
BTC `maxLeverage` 40, `szDecimals` 5, $10 minimum order notional (exchange rule; **no guard in our code**).
Mid $76,764.5 at 07:26:43Z.

| bankroll | margin | S1 notional (10x) | S6 notional (8x) | S6 size BTC | S6 $ at risk (2% stop) | S1 $ at risk (3% stop) | S6 round-trip fee | S6 notional / $10 min |
|---|---|---|---|---|---|---|---|---|
| $25 | $1.25 | $12.5 | $10.0 | 0.00013 | $0.20 | $0.38 | $0.009 | 1.0x |
| $50 | $2.50 | $25 | $20 | 0.00026 | $0.40 | $0.75 | $0.018 | 2.0x |
| **$103.15** (now) | $5.16 | $51.6 | $41.3 | 0.00054 | $0.83 | $1.55 | $0.037 | 4.1x |
| $200 | $10 | $100 | $80 | 0.00104 | $1.60 | $3.00 | $0.072 | 8x |
| $500 | $25 | $250 | $200 | 0.00261 | $4.00 | $7.50 | $0.18 | 20x |
| $1,000 | $50 | $500 | $400 | 0.00521 | $8.00 | $15.00 | $0.36 | 40x |
| $3,650 (10x of the measured sample) | $182.5 | $1,825 | $1,460 | 0.0190 | $29.20 | $54.75 | $1.31 | 146x |

- **Bankroll below which a trade cannot size:** S6 needs 0.4 x bankroll >= $10 -> **$25**; S1 needs 0.5 x bankroll
  >= $10 -> **$20**. At $103 both strategies are 4-5x above the floor. Below ~$50 the 0.00001 BTC size step
  (0.77 USD) rounds notional by up to 2-4%, which matters for stop placement, not for the exchange.
- **Leverage cap:** 40x on BTC at our notional tiers; our 8x/10x isolated are nowhere near it. Nothing changes
  at 10x bankroll.
- **Liquidity at our notional:** $151 average notional (W1) is 0.0020 BTC against 6.90 BTC at the best bid and
  7.22 BTC at the best ask (one snapshot, 07:26:43Z). Every entry crossed one level. At $3,650 bankroll S1 notional
  is 0.024 BTC = 0.3% of the top level; the book is not the constraint before ~$50k notional, and the measured
  slippage (+0.24 bps mean) agrees.
- **What 2x/5x/10x changes:** only the dollar size of -$1.08/trade. Fee rate, slippage, stop slippage and fill
  latency are all flat in size at this scale. The $260 withdrawal (ledger `send` 2026-11-02 17:44:24Z, $260.00,
  fee $1.00) is not a loss; the $103.15 that remains can run both strategies mechanically.

---

## 7. Decisions for H (preferences, not findings)

1. **Treat B3 as blocking.** 0 of 16 signals executed in 16 days, and every health signal (dead-man, WS loop,
   Discord digest, UI) said fine. Whatever H decides about strategies, decide first whether the VPS is meant to
   trade; if yes, fix the wallet and add a write-path probe before any other work.
2. **Prefer S1-only over S1+S6** if the bot trades at all: S6 is -$27.47 live (n=26, PF 0.26), -$31.75 in the
   same-window backtest, and PF 0.94 on the extended OOS; S1 is the only configuration positive in both OOS
   windows (PF 1.30, 13 trades). I would not call S1 an edge; I would call S6 a measured drag.
3. **Prefer B6 (ETH/SOL backtests) over any new BTC strategy idea.** The cheapest way to get S1 from 13 OOS
   trades to ~40 is more assets, not more years. Data is there (HTTP 200 on 2022-02 and 2026-09 zips).
4. **Prefer B4 (paper ledger) over "run it live small".** $103 live produces one S6 observation every ~2.7 days
   at ~$0.03 fee each; paper produces the same observation for free and would have kept counting through the
   dead window.
5. **Do not spend on cascade.** 955 heartbeats, all `medium`, all `ethereum`, impact max $1.28M. The sibling
   project has never sent the severity S5 waits for. Keep the log, revisit at a first `high`.
6. **Ignore bankroll scaling as a lever** until something has positive expectancy: the arithmetic in section 6
   says size changes nothing but the sign's magnitude.

---

## 8. `[verify: A]` list

1. Does Hyperliquid's `candleSnapshot` 5,000-candle cap (15m history reaches only 2026-09-12; 1h 2026-04-08; 4h
   2024-07-23 as measured 07:38Z) match the documented limit, and is there an archive endpoint we are missing?
2. Are Binance **spot** 15m klines (what `data.binance.vision/data/spot/...` serves, and what our backtests use)
   an acceptable proxy for Hyperliquid **perp** prices for ETH/SOL, and is the futures archive
   (`data/futures/um/...`) a better source for B6?
3. Fee reduction paths on Hyperliquid below 4.32 bps taker at our volume: staking-discount tiers (`userFees` shows
   0% today), referral terms, maker rebates -- what would a $100-$1,000 account realistically reach?
4. Minimum order notional on alternative venues vs a $103 account (the $10 figure here is Hyperliquid's).
5. Public evidence on BBWP-compression-breakout rules on BTC 1h: any out-of-sample result with PF > 1.1 after
   fees, or is S6 known to be a chop-loser elsewhere too?
6. The sibling project's cascade severity thresholds: under what on-chain conditions does it emit `high`, and has
   it ever emitted one anywhere (we have 0 in 3,669 heartbeats since 2026-05-06)?
7. Whether the 08:18-09:36 UTC weekend 502s from `api.hyperliquid.xyz` (10 episodes in 75 days) are a known
   maintenance window.

---

## 9. Sharpest caveat about my own read

Everything in section 1 rests on 28 trades in one 73-day window that was mostly chop, with S1 contributing one
trade. The live set never traded through a sustained trend, so "catches almost none of the trend" is measured
only on the 31 >3%-24h episodes here, not on the regime S1 was designed for. The same-window backtest matching
(20 of 28 entries, same loss) shows the implementation is faithful; it does not show the strategy would lose in
other windows -- the 444-day OOS says flat, the 488-day OOS says slightly negative, both are small numbers around
zero. The slippage and timing numbers use the bot's own mark/snapshot price as the reference, which is the right
reference for "did we get the price we decided on" but not an independent view of the market. The cascade look is
in-sample on ~41 days of hourly, autocorrelated data. And nothing here can see what the bot would have done
between 2026-10-18 and today: 16 signals, 0 orders, and no paper record.

---

## 10. "Measured, fine / measured, dead" list

**Measured, fine (do not re-open):**
- Taker fee 4.32 bps on 65/65 fills; maker share 0 by design; funding net +$0.01 over 110 position-hours (W1).
- Entry slippage +0.24 bps mean / $0.10 total over 28 entries; stop slippage +1.65 bps mean / $0.25 total; bot
  exit slippage -0.16 bps; fills 4.5 s after bar close (W1).
- Book depth: 6.9-7.2 BTC at the touch, 0.13 bps spread; our notional is 0.03% of one level (07:26:43Z).
- Sizing floor: S6 $25, S1 $20 bankroll; $103 is 4-5x above it.
- OCI2 headroom: 0.04% CPU, 346 MB RSS of 11.9 GB, 20% disk; RTT 160-300 ms; a second bot or venue costs the
  same again, which is nothing.
- Dead-man cron: 7,095 `ok`, fired 3 times on 09-11/09-13 (snapshots show only single-bar gaps those days, so
  likely log-sink lag, unverifiable now -- Sept out-logs are rotated away).
- WS loop: 99.6% bar-close completeness; 10 weekend-morning reconnects, all recovered in 1-4 min.
- Command channel: the 30-second flap ran 08-22 -> 09-24 (75k rows) and stopped with the 09-24 deploy; 2 real
  backoffs since.
- Backtester reproduction: `--from 2025-07-01 --to 2026-09-18` gives 191 / +$8.88 / PF 1.03 / DD 11.7% / Sharpe
  0.23 -- identical to `docs/polish/s52-corrected-matrix.md`. Persisted row: `backtest_runs` created
  2026-11-03 ~07:31Z (local file `backtest-results/444d-20261103-083133.json`, gitignored), dataset 2022-02 ->
  2026-10 in the session scratchpad. Note the checked-in `data/bt-data/` on this machine ends 2026-05-31 and
  cannot run that window without a download.
- Trailing-stop oid capture: 127 modifications, every `oid=X -> Y` carried forward, 0 failures before DEAD.

**Measured, dead (do not re-open without new data):**
- S6 live: PF 0.26 / -$27.47 / 26 trades (W1); PF 0.14 / -$18.18 / 13 trades (W2); same-window backtest PF 0.38.
- S1+S6 as a set on the extended corrected OOS: PF 0.96, -$16.19 (2025-07-01..2026-10-31).
- S3, S6+regime, S1+S2+S6, all-four: negative again on the extended OOS.
- Cascade as a signal: no `high` in 3,669 heartbeats; impact max $1.28M; one chain; hourly cron.
- Bankroll scaling, fee tier, slippage, latency as levers: size-invariant at < $50k notional.
- Exchange access from the VPS: dead since 2026-10-18 09:45 UTC (`User or API Wallet 0x483dd…9369 does not exist`),
  16 bot signals + 4 manual commands with 0 orders through 2026-11-02 15:30.
