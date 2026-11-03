# MERGE_NOTES_FROM_A -- closer review of MERGED_CANDIDATES.md (Round 4)

**Closer:** Seat A, 2026-11-03. **Read:** MERGED_CANDIDATES.md, REVIEW_A/B, NOTES_FROM_A/B, REDTEAM.md.
**Code check:** `src/backtest/engine.ts:45` and a `grep` of `backtest_oos.ts`. No new research.

## 1. Provenance notes (the coordinator's 11 named claims)

| # | claim | finding |
|---|---|---|
| 1 | §0 / C5 `[B-only]`, A quote | **Holds.** NOTES_FROM_A §3, B3 row reads verbatim "Nothing else on either list matters until this is fixed." REVIEW_A has no exchange-access row. |
| 2 | C2 `[BOTH]`, CLOSED via A's own flips-if | **Holds.** A2 and B6 are independent Round 1 EVALUATE rows. A's §4 fail clause ("fewer than 2 alts pass"; pooled test PF < 1.1) is met by B R2 §4 (0 of 3 alts pass; pooled test 0.79). A confirms the flip now; A's own Round 2 said "not run" only because B's notes were unseen. |
| 3 | C3 `[BOTH]`, "yes in substance" | **Holds.** A3 (EVALUATE) and B9 (CLOSED) are both Round 1 rows, and A R2 §5 reads "yes in substance". B R2 tag 1 then met A3's gate by the letter (PF 1.05 at zero fee < 1.10); say so. |
| 4 | S6 KILL `[B-only]` | **Holds.** A1 reads "S1 (+S6 pending A3)"; A's concession is at R2 §3 (B1 row) and §5 (A3). **But** verdict line 47 tags "S6 is signal-dead…" `[BOTH]`. Split it: signal-dead `[B-only]`, PF 1.05 at zero fee `[BOTH]`. |
| 5 | C6 `[A-only]` | **Holds.** B's Round 1 has no yield row; B R2 §3 concedes "EVALUATE" with 98.5% idle. That 98.5% is B's R2 tag 6 and should carry its attribution in the evidence column. |
| 6 | C8 `[B-only]`, gate `[merger]` | **Wrong by the merge's own definition.** `[B-only]` means a Round 1 finding; C8 is a B R2 §4 side result. Tag it `[B R2]`. The gate is correctly `[merger]`, but its content fails (§2). |
| 7 | Q2 `[BOTH]` | **Wrong.** A's Round 1 had no high-gate finding; A only answered B's tag in R2. This is `[B-only]` with A's R2 answer in words. "Runbook Task C" and "C7 cannot be decided without it" are `[merger]`, untagged. |
| 8 | Q3 `[BOTH]`, both caveats "measure the stop" | **Wrong for A.** A R2 §8 is about vol-targeted top-20 baskets vs a fixed rule on 3 alts; it never mentions the stop. Only B R2 §8 says "the stop". Tag it `[B R2]`, cite A's related caveat in words, and tag the ATR-stop design `[merger]`. |
| 9 | Dispute 1, funding premise | **Holds.** `engine.ts:45` is `DEFAULT_HOURLY_FUNDING_RATE = 0.0000125` (flat 10.95% APR), and `backtest_oos.ts` has no funding reference. A's premise was wrong; A accepts B. A R2 §5 flip (c) = "no", and it still is at PF 1.22. |
| 10 | "S1 zero-cost default, not an edge" `[BOTH]` | **`[BOTH]` is right on substance.** Round 1: A1 MONITOR and B2 WATCH (B §7 #2: "I would not call S1 an edge"). The phrase "zero-cost default" and the noise conclusion are B's R2 flip plus A's A2 flips-if. C1's *S1-only* half (drop S6) is `[B-only]` (B5) plus A's concession. |
| 11 | §3 `[A-only]` except the costs line | **Holds.** All four flow bullets trace to REVIEW_A §6, and the C2 cross-reference is tagged. The costs line uses funding +$0.08 (B R2 tag 4) where B R1 §4 says +$0.011; cite which number is used. |

## 2. Disposition check

- **C8 gate is unreachable on existing numbers.**
  - XRP S6 train PF is 1.10, so the "≥ 1.15 in both windows" leg already fails.
  - The pair count is 6 + 3 = 9, not 7.
  - "The only pair positive in both windows" is false: ETH S1 is 1.08/1.20 and ETH S6 is 1.05/1.01.
  - Recommend **CLOSED**, flipping if a pre-registered multi-asset S6 replay passes.
- **C11 collapses A9's flip.** A9 flips on a sustained cross-venue spread above ~10% APR, with both venues usable from
  the EU. Restore it as a separate line (kind L).
- **C13 collapses A12's flip.** A12 flips on an out-of-sample test of a post-listing fade that survives Hyperliquid's
  listing delay. Restore it separately (kind L).
- **The verdict's flips-if (a) and (b) use `[merger]` thresholds** (≥ 100 unseen trades; ≥ 60 paper S1 trades) but are
  untagged. A's verdict flip (d), the idle-cash look-up, is dropped. Tag (a) and (b), and point (d) to C6.
- **The remaining rows pass completeness.** Each has one disposition, BUILDs have scope, gate, capital and effort,
  EVALUATE C6 has a numeric gate, and MONITORs name their triggers.

## 3. Concessions

- **A's concessions to B are honoured** (S6 kill, crowd-out, B3, B4, B9/B10, B11, withdrawn matrix correction), and so
  are **B's to A** (A4 EVALUATE, A3 closed with its number, A6/A7 MONITOR).
- **Not honoured, though not a concession either:** A R2 §1 disputed the data source for the alt replay (futures
  archive, not spot). B R2 tag 8 checked spot, and §9 is silent. Record it as unresolved; it is unlikely to flip C2.

## 4. Drift, over-reach, inflation

- **Verdict line 54 says market makers and HLP capture the flow, "neither of which a $1k … participant can join"
  `[A-only]`.** A R1 §6 and the merge's own §3 say HLP *is* joinable as a depositor, as crash-concentrated yield below
  lending.
- **Verdict line 43: "the only positive number … is yield".** S1-BTC is positive (PF 1.30 / 1.22). Write "the only
  *sure* positive number", matching A R1 and B R2 §7.
- **§11 item 1 bundles items no voting seat raised into the C5 restart:** Supabase key rotation (from C's prior) and the
  Q1 aggregation fix (`[redteam]` + `[merger]`). Tag both. Keep the live-runtime code change out of the restart that is
  C5's gate, or state the confound.
- **C5 "If it fails" swaps B's learning for a `[merger]` 180-day-expiry hypothesis under `[B-only]`.** B's learning:
  "revoke last" was not followed and needs a checklist. Tag the hypothesis or restore B's text.
- **Nits, not required:**
  - C1's "costs ~$3/yr in fees" is B's $3.04 over 488 days at $500; at $103 it is about $0.5/yr.
  - C14 `[BOTH]` leans on A §7 #1, an H-decision line rather than a candidate row.
- **Size:** 15 rows plus 10 decisions plus 10 questions is at the inflation edge but acceptable. I found no other prior
  leakage.

## 5. Verdict: **NEEDS REVISION**

1. **C8:** re-tag `[B R2]`, fix the pair count, and either fix the gate (XRP train 1.10 already fails ≥ 1.15) or set
   C8 to CLOSED with a flip. Drop "the only pair positive in both windows".
2. **Q3:** re-tag `[B R2]` with A's vol-targeting caveat in words, tag the ATR-stop design `[merger]`, and reword C2's
   "the one caveat both seats left standing".
3. **Q2:** re-tag `[B-only]` with A's R2 answer in words, and tag the runbook and the "C7 cannot be decided" claim
   `[merger]`.
4. **Verdict:** split the S6 clause tags (§1 #4); fix "neither … can join" for HLP; write "only *sure* positive number";
   tag flips (a) and (b) `[merger]`, and point A's (d) to C6.
5. **C11 and C13:** restore A9's and A12's flips as separate lines with their kinds.
6. **§11 item 1 and C5:** tag the Supabase rotation, the Q1 fix and the 180-day hypothesis `[merger]`/`[redteam]`, and
   separate the Q1 code change from C5's gated restart.
7. **§9:** add A's unresolved spot-vs-futures data-source dispute (non-blocking), and say which funding figure the §3
   costs line uses.

## Round 4b -- re-check of the 7 points (2026-11-03)

1. **Fixed.** C8 is now `[B R2]`, the pair count reads 9, and the false "only pair positive" line is replaced by
   three pairs above 1.0. C8 is CLOSED, with the pre-registered DOGE/ADA/LINK replay as its flip (§4, §5, §8).
2. **Fixed.** Q3 is `[B R2]` for the stop point, A's vol-targeted-basket caveat is in words, and the ATR design is
   `[merger]`. C2's flip text no longer says "the one caveat both seats left standing".
3. **Fixed.** Q2 is `[B-only]` with A's answer as `[A R2]`; the runbook pointer and "C7 cannot be decided" are
   `[merger]`.
4. **Fixed.**
   - The S6 clause is split: signal-dead `[B-only]`, PF 1.05 `[BOTH]`, with "met A3's gate by the letter".
   - HLP is described as joinable as a depositor, and the verdict now says "only *sure* positive number".
   - Flips (a) and (b) are tagged `[merger]`, and (d) points to C6.
   - Optional: §11 item 3 still says "the one positive number" without "sure".
5. **Fixed.** C11 and C13 carry A8/A9 and A11/A12 flips as separate lines with kinds, in both §4 and §8.
6. **Fixed.** The Supabase rotation is `[merger]` from C's prior. The Q1 code change is deployed only after C5's
   gate passes (C5 scope and §11 item 1). B's "if it fails" text is restored, and the 180-day theory is `[merger]`,
   unverified.
7. **Fixed.** §9 #7 records the spot-vs-futures dispute as unresolved and non-blocking. The §3 costs line names B R2
   answer 4 (+$0.08) over B R1's +$0.011.

The nits on C1 ($0.5/yr at $103) and C14 (cites an H-decision line) were also applied. Counts reconcile: BUILD 2,
EVALUATE 1, MONITOR 4, CLOSED 8, 15 rows.

**Verdict: SHIP-READY.**
