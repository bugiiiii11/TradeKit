# NOTES_FROM_B -- cross-review of REVIEW_A (Round 2)

New read-only measurements 2026-11-03 08:40-09:30 UTC via `scripts/B/bt_oos_trades.ts` and `oos_summary.py`; alt CSVs
in the scratchpad, renamed to the loader's `BTCUSDT-15m-*` pattern. Split as `backtest_oos.ts`: train
2023-02-04..2025-06-30, test 2025-07-01..2026-10-31, $500 per window.

## 1. Items I dispute in A

- **§1 correction 1 / §8 #2 ("backtest models Binance funding; Hyperliquid runs higher").** Wrong premise: the OOS
  scripts never load the funding CSV; the matrix charges a flat 10.95% APR (`engine.ts:45`). Hyperliquid's real series
  averaged **7.44% APR** in the test window (lower), 19.5% in train.
- **A1 "[1] $500k at ~0.1 bp" (404 source).** Measured: best bid 6.90 BTC / ask 7.22 BTC, spread 0.13 bps, top-10 bids
  $2.45M (l2Book 07:26:43Z). Same conclusion; replace the citation.
- **§1 "keep S1" as incumbent.** Live S1 is n=1 and the VPS has placed no order since 2026-10-18 09:45Z. The merge
  must not inherit a running incumbent.

## 2. Candidates A missed that I caught

- **B3 restore exchange access** -- 16 S6 signals + 4 manual commands, 0 orders in 16 days; all health signals said fine.
- **B4 paper-execution ledger** -- 52 S6 SIGNAL lines logged vs 26 traded.
- **B11 Supabase `trades` P&L** -- mark-based, gross, one trip missing; overstates by $3.41 on -$30.09.
- **Participation** -- flat in 11 of 31 >3%-24h moves, incl. the two largest.

## 3. Candidates A caught that I missed -- concede

- **A4 idle-bankroll yield.** Tag 6 makes it stronger than A said: 98.5% idle time-weighted. **EVALUATE** (H's risk
  call; ~$4/yr at $103, ~$36/yr at $1k).
- **A3 fee sensitivity as a question.** Measured: S6 test PF 1.05 at zero fee. **CLOSED**, now with the number.
- **A6/A7 venues, regulation** -- outside my reach; MONITOR.

## 4. Answers to A's `[verify: B]` tags

| tag | answer (number + window / file:line) | confidence |
|---|---|---|
| 1 fee totals, fee reruns | Fees at 0.045% taker, test 2025-07-01..2026-10-31 (488d): **S1 $3.04, S6 $39.00, S1+S6 $39.16**; train: S1 $4.33, S6 $77.41, S1+S6 $72.48. Re-priced per trade (compounding ignored): S6 test PF **0.94 → 1.01 (maker) → 1.05 (zero)**, pnl -$21.52 → +$4.47 → +$17.47; S1+S6 test 0.96 → 1.03 → 1.06; S1 test 1.30 → 1.37 → 1.40; S6 train 1.10 → 1.17 → 1.21. A's $36 estimate ≈ right ($35 on the 444d window). **A3 gate: FAIL** (S6 test PF < 1.10 at fee 0) → signal-dead, not fee-killed. `bt_oos_trades.ts`, `oos_summary.py` | high |
| 2 funding correction | See §1. S1 test: long 564h / short 1,150h (net *short*); flat model -$1.95 (net received), **real Hyperliquid funding +$1.53 cost**. S1 test PF 1.30 → **1.22, +$9.20**; train 1.53 → 1.41, +$33.48. S1+S6 test -$16.19 → -$18.62. Real-series APR: test 7.44% (53% of hours at floor), train 19.5%, 2026-08-20..11-03 9.35% (70% at floor). `fundingHistory` 29,943 rows from 2023-05-12. **Flip (c): no.** | high |
| 3 live execution vs model | REVIEW_B §4: entry vs bot mark +0.24 bps mean (n=28, max +6.4); vs HL 15m close +0.05 bps (n=17); stop fill vs trigger +1.65 bps (n=10, max +5.4); bot exits -0.16 bps; 4.5 s bar-close→fill. $0.35 total over W1. `SLIPPAGE_BPS = 0` is within $0.01/trade of truth. | high |
| 4 live funding per trade | W1 bot trips: live net **+$0.080** (longs -$0.133 over 193h, shorts +$0.213 over 321h); flat model would give +$0.241. Per trade +$0.003 live vs +$0.009 model. Mean rate in position 7.99% APR, 37% of hours at floor. `userFunding`, 110 events 2026-08-27..10-19. | high |
| 5 lifetime volume | VPS `0x5642…4110`: 166 fills, **$23,381**, fees $10.04, BTC only, 2026-04-24..10-19. Desktop `0x3a8a…4C46`: 1,324 fills, **$1,161,621**, fees $465.49, 19 coins, 2026-04-10..10-30 -- above A's $100k sub-account threshold; who traded it is `[verify: H]`. `userFillsByTime` from 0. | high |
| 6 margin share | **1.45%** of bankroll time-weighted over W1 (9,629 $·h / 1,807h at ~$367); 4.99% while in a position; peak trade margin $19.25. | high |
| 7 S5 grading | REVIEW_B §5 plus +8h: top-decile by debt (≥$111.3M, n=97 overlapping hours) -0.35%, 73% down vs rest -0.03%, 49%; by impact -0.22% vs -0.05%; by imminent nothing. Those 97 hours are **4 independent episodes** (09-24, 09-27, 10-06, 10-30); worst 24h drop after each: -0.84%, -0.97%, **-3.63%**, -0.93% → 1 of 4 reach -3%. A5 flip (≥3 events): **no**. 955/955 `medium`, `ethereum`. | medium (in-sample, 41 days) |
| 8 A2 data availability | `data.binance.vision` spot 15m monthly: ETHUSDT, SOLUSDT, XRPUSDT **57/57 months 2022-02..2026-10** (HTTP 200, 2026-11-03). HYPEUSDT spot: 404 through 2026-07, 200 from 2026-09; HYPEUSDT USDⓈ-M futures from 2025-06 (~17 months) -- short of the 55-month warmup. `fapi…/fundingRate` 200 for ETH/SOL/XRP/HYPE. | high |
| 9 referral | Both wallets: `referredBy.code MMREFCSI` (referrer `0x5a65c4…3844`), `activeReferralDiscount 0.04`, staking 0 → effective taker **4.32 bps**, matching 65/65 live fills. `referral` + `userFees`, 2026-11-03. | high |
| 10 matrix wording | On the printed 444d matrix A is right (S6 +$74.19/+$3.27, S1+S6 +$79.64/+$8.88 both positive). Test extended to 2026-10-31: S6 **-$21.52 (PF 0.94)**, S1+S6 -$16.19 (0.96), S1 +$12.62 (1.30) → S1 is now the only one positive in both, with or without real funding (1.41/1.22). | high |

**A2 gate, measured (unchanged S1 rule, 3% stop, 10x):**

| asset | S1 train n / PF / pnl | S1 test n / PF / pnl | A2 gate (PF ≥ 1.2 both) | S6 train PF / test PF |
|---|---|---|---|---|
| BTC | 19 / 1.53 / +$42.62 | 13 / 1.30 / +$12.62 | pass | 1.10 / 0.94 |
| ETH | 24 / 1.08 / +$8.70 | 10 / 1.20 / +$12.14 | fail | 1.05 / 1.01 |
| SOL | 17 / 0.59 / -$37.04 | 14 / 0.32 / -$40.73 | fail | 0.96 / 1.13 |
| XRP | 17 / 0.83 / -$13.93 | 13 / 0.50 / -$30.69 | fail | 1.10 / 1.18 (n=399/235) |
| pooled S1 all four | 77 / 1.00 / +$0.35 | **50 / 0.79 / -$46.66**, DD 18.6% | **fail** (needs ≥1.2, n ≥ 40, DD ≤ 15%) | -- |

**Flip (a): no; A2: FAIL.** Side result nobody proposed: S6 on XRP positive in both windows -- one hit in 3 alts × 2
rules is chance-sized; EVALUATE at most, after a fourth asset.

## 5. Flip-check (my Round 1 `flips if:` lines)

- **Verdict** (S6-only OOS PF ≥ 1.2 on ≥100 fresh trades / 20 live S1 at PF > 1.3): **no.** S6 BTC test 0.94.
- **B1 S6 KILL-CANDIDATE** (same gate): **no.** XRP 1.18 is another asset, below the bar.
- **B2 S1 WATCH** ("S1 OOS on 2+ other assets PF < 1.0"): **yes** -- SOL and XRP, both windows. I now hold A's §4 view:
  13 BTC trades are most likely noise. New disposition **MONITOR**: zero-cost default, no investment.
- **B3 / B4 BUILD** (owner intends signal-only / never runs unfunded): **no** evidence in A.
- **B5 EVALUATE S1-only live**: **no**; with B2 flipped it is a default, not an experiment.
- **B6 EVALUATE ETH/SOL** ("ETH and SOL both PF < 1.0"): **no by the letter** (ETH test 1.20); done → **CLOSED**.
- **B8, B9, B10, B12 CLOSED**: **no** -- A's fee table agrees; VPS lifetime volume $23k.

## 6. Disposition reconciliation

- **S1:** A1 MONITOR vs my WATCH → **MONITOR**; alt replays decide it (pooled test PF 0.79).
- **S6 fees:** A3 EVALUATE vs my B9 CLOSED → **CLOSED**; PF 1.05 at zero fee also kills maker-entry and Lighter.
- **S1 basket:** A2 vs B6, both EVALUATE → **CLOSED (failed)**.
- **Cascade:** A5 vs B7, both MONITOR → **MONITOR**; 1 of 4 episodes, no `high` ever.
- **Idle yield:** A4 EVALUATE vs none → **EVALUATE**.
- **B3, B4:** mine only → **BUILD** stands.

## 7. Net assessment

No strategy candidate survives measurement: S6 is signal-dead (PF 1.05 at zero fee), S1 does not generalise (pooled
alt PF 0.79), cascade never emitted its trigger severity, and the live pipeline has executed nothing since 2026-10-18.
Build only B3 (if H wants a live bot at all) and B4 (so the next candidate is judged on 52 observations, not 26). The
one positive number on either page is A4's yield on the 98.5% idle balance -- H's risk decision, not a trading result.

## 8. Sharpest surviving caveat in my own review

The alt replays apply BTC's 3% stop and 10x to assets with 1.5-2x its volatility, so "S1 fails on SOL/XRP" partly
measures the stop, not the rule; and every live number rests on 28 trades, one of them S1.
