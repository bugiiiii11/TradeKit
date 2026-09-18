# S52 -- the corrected strategy matrix

**Every backtest number produced before commit `71d3422` is inflated by lookahead.** This document is
the re-run on honest alignment, and the re-decision of everything that was decided on the old numbers.

Reproduce either table:

```
npx ts-node src/scripts/backtest_oos.ts                     # corrected (default)
npx ts-node src/scripts/backtest_oos.ts --legacy-lookahead  # the archived, inflated numbers
```

Both: Binance 15m, bankroll $500 per window, 5% margin, PMARP 20/350, fees and funding modelled.
Train 2023-02-04 -> 2025-06-30 (877d). Test 2025-07-01 -> 2026-09-17 (444d), report-only.

## The bug

`aggregator.ts` timestamps every bucket by its START. `aligner.ts` then attached "the most recent
higher-TF bar with `timestamp <= now`" -- which is the bar still being FORMED -- and handed the engine
its final close. The engine was reading up to **45 min of future data on 1H, 3h45m on 4H and 23h45m on
1D**, on every bar, for every strategy, in every backtest this project has ever run. The aligner's own
docstring described the correct behaviour; only the code disagreed.

Smoking gun: under the old alignment, 27 of 27 S6 entries in the live windows landed exactly on the
hour. A bot that evaluates every 15 minutes cannot do that. Corrected: 0 of 29. Live: 4 of 22.

The live bot never had this bug -- `candle-consumer.ts` aggregates from the 15m buffer and
`aggregate()` drops an incomplete final bucket, so it only ever reads a closed higher-TF bar. The
corrected aligner now matches live semantics exactly.

## Test window (out-of-sample), legacy vs corrected

| Configuration | legacy PF | **fixed PF** | legacy PnL | **fixed PnL** | fixed WR | fixed MaxDD | fixed Sharpe | n |
|---|---|---|---|---|---|---|---|---|
| S1 only | 6.60 | **1.30** | +$61.29 | **+$12.62** | 31% | 5.9% | 1.65 | 13 |
| S2 only | 0.81 | **1.13** | -$18.00 | **+$10.64** | 44% | 4.8% | 0.85 | 71 |
| S3 only | 0.51 | **0.48** | -$91.01 | **-$90.02** | 29% | 18.2% | -7.11 | 839 |
| S6 only | 1.85 | **1.01** | +$243.04 | **+$3.27** | 39% | 10.3% | 0.14 | 198 |
| **S1 + S6 (live set)** | 1.99 | **1.03** | +$265.74 | **+$8.88** | 40% | 11.7% | 0.23 | 191 |
| S1 + S2 + S6 | 1.56 | **0.92** | +$175.18 | **-$28.11** | 40% | 19.5% | -0.40 | 221 |
| All (S1+S2+S3+S6) | 1.16 | **0.86** | +$64.63 | **-$62.95** | 33% | 26.2% | -0.84 | 593 |
| S6 + regime (block chop) | 7.28 | **0.82** | +$169.58 | **-$9.67** | 34% | 3.2% | -1.11 | 29 |
| S1 + S6 + regime on S6 | 8.33 | **0.89** | +$226.81 | **-$9.75** | 32% | 8.5% | -0.49 | 38 |

Train window, corrected: S1 +$42.62 (PF 1.53, Sharpe 2.32, DD 6.5%, n=19) | S2 -$55.00 (0.74) |
S3 -$179.09 (0.43) | S6 +$74.19 (1.10) | S1+S6 +$79.64 (1.10, DD 14.2%) | S6+regime +$63.07 (1.45).

## What this re-decides

1. **S51's headline is dead.** "The live S1+S6 set holds up out-of-sample, PF 1.99 on 182 trades" is
   PF **1.03** on 191 trades -- flat after costs. Not a loss; not an edge.
2. **The S6 regime filter stays rejected, and now for a solid reason.** S51 rejected it as a
   small-sample artifact at PF 8.33. Corrected it is PF 0.82 / **-$9.67** out-of-sample, while looking
   good in-sample (PF 1.45). That is the signature of a fitted filter, not a real one.
3. **S3 stays disabled.** Negative under both alignments, in both windows, on 839 test trades. This is
   the one verdict the bug never flattered.
4. **S2 stays disabled.** It inverts between windows (-$55 train, +$10.64 test) which is noise, and
   adding it to the live set turns +$8.88 into -$28.11.
5. **S1 is the only configuration positive in BOTH windows** -- and on every risk-adjusted measure it
   beats the live set it is currently bundled into:

   | | PnL | PF | Sharpe | MaxDD | trades |
   |---|---|---|---|---|---|
   | S1 alone (test) | +$12.62 | 1.30 | 1.65 | 5.9% | 13 |
   | S1 + S6 (test) | +$8.88 | 1.03 | 0.23 | 11.7% | 191 |

   S6 contributes 178 extra trades, doubles the drawdown, cuts Sharpe by 7x, and **loses $3.74**.
   The caveat is real though: S1 is 32 trades across 3.6 years (~9/yr), which is too few to call an
   edge either way. "S1 alone looks best" and "S1 is unproven" are both true.

## Honest summary

No configuration in this matrix demonstrates a robust edge out-of-sample. The live set is flat, the
best-looking option is undersampled, and the two parked strategies stay parked. Everything this
project concluded about strategy performance before `71d3422` was measured with future data.

Open decisions for the owner (none actioned here -- no strategy config was touched):

- Keep running S1+S6 flat, or drop S6 to S1-only (fewer trades, better risk profile, thin evidence)?
- Freeze the leverage decision (handoff row 6) until something here clears a real significance bar.
- The `backtest_results` rows in Supabase and the frontend's "backtest reference" per-strategy
  scoreboard are all pre-fix, and currently flag live S6 as underperforming a reference that never
  existed (handoff row 14).
