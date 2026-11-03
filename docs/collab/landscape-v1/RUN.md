# Landscape Campaign v1 -- "what else should TradeKit build?" (set up S54, 2026-11-03)

Pattern: **Parallel Review with Tagged Merge**, *landscape / expansion variant* (plain, no scorecard), with a
non-voting red team and an external merger. Protocol:
`c:\work\___research\multi_session_collab\PARALLEL_REVIEW_TAGGED_MERGE.md`. Templates and worked example:
Flash `docs/collab/optim-v2/` (Nov 2026) and Flash `docs/landscape-method.md` (outcomes O1-O5). This file is the
run record; the coordinator keeps it current.

## Question

TradeKit runs S1 (4H EMA trend) + S6 (1H BBWP breakout) on BTC perps on Hyperliquid with ~$103 (was $382 until a
$260 withdrawal on 2026-11-02). The corrected out-of-sample backtest says the live set is break-even (PF 1.03,
+$8.88 over 444 days); live since 2026-09-23 it is 2 wins / 12 losses, -$18. **Where is an edge this project can
actually capture with $100-$1,000, a 15-minute bar clock, one ARM VPS and no colocation -- on Hyperliquid or
elsewhere -- and what should it build next?** The answer must be a candidate table with exactly one disposition per
candidate (BUILD / EVALUATE / MONITOR / CLOSED), a flip condition per row, and 1-3 ranked recommendations written
for the owner. "Keep S1 only and build nothing" is a valid answer if the numbers say so.

**Not** in scope: re-tuning S1/S6 parameters (a separate pass), reviewing the bot's crash-day robustness (the
review campaign, if ever run), and anything that changes production during the run.

## Seats

| Seat | Lean | Model | Reads | Writes |
|------|------|-------|-------|--------|
| A | **Desk research** -- venues, mechanisms, who captures which flow and how, what a $100-$1k participant can reach; web + repo docs | Opus 5.5, fresh tab in `C:\work\TradeKit`, NO `/start` | repo docs + strategy code named in the brief, the web (cited) | `REVIEW_A.md`, later `NOTES_FROM_A.md` |
| B | **Our own numbers** -- realised edge per strategy, fees and funding actually paid, slippage, capacity, what 2x bankroll changes, the cascade data; measure, don't infer | Fable 5.1, fresh tab in `C:\work\TradeKit`, NO `/start` | repo, Supabase via the repo's scripts, Hyperliquid info API, read-only SSH to OCI2 | `REVIEW_B.md`, later `NOTES_FROM_B.md` |
| R | **Red team** -- non-voting: for each seed candidate and for the current S1/S6, "why would this NOT pay" | subagent spawned by the coordinator at Round 1 start | repo source only + the seed list in `BRIEF_R.md`; no docs, no web | `REDTEAM.md` |
| C | **Coordinator + external merger** | this session (S54, desktop lane) | everything, in gate order (read-never list below) | `MERGED_CANDIDATES.md`, gate notes here |
| H | the owner -- paste-only, tiebreaker on `[DISPUTED]`, owner of the decision table | -- | `PASTES.md` | nothing |

Reach, so `[verify: X]` tags are aimed right: **A** has the repo (read-only) and the web; no Supabase, no SSH, no
Hyperliquid API beyond public docs pages. **B** has the repo, Supabase through the repo's own scripts (the key is
loaded by `dotenv` -- B never reads `.env`), the public Hyperliquid `info` API, and read-only SSH to OCI2; B may
NOT restart, edit `.env`, deploy, send an order, or write to the repo outside its own files. **R** has the repo
source only. **C** has everything B has. Anything only the owner can answer (KYC / residency / tax / appetite) is
tagged `[verify: H]` and goes to the decision table.

## Rounds

| Round | Who | Output | Gate (C checks before the next paste) |
|-------|-----|--------|----------------------------------------|
| 1 | A, B (parallel, blind) + R (spawned at the same time) | `REVIEW_A.md`, `REVIEW_B.md`, `REDTEAM.md` | skeleton followed, caps respected, every row cites a source with a date / a measurement with its window / `file:line`, `flips if:` on every BUILD / EVALUATE / CLOSED and on the verdict, no `/start`, nothing written outside the seat's files |
| 2 | A reads B, B reads A (not each other's NOTES) | `NOTES_FROM_A.md`, `NOTES_FROM_B.md` | 8 sections, <=2 lines per item, verify-tags answered, flip-checks answered yes/no, disposition reconciliation done |
| 3 | C | `MERGED_CANDIDATES.md` | provenance: every row and line traces to A, B, R or `[merger]`; disputes resolved by flip-check or re-classed as decisions |
| 4 | closer = the seat with LESS of its own material in the merge (C counts tagged items; tie -> A) | `MERGE_NOTES_FROM_<closer>.md` | verdict ship-ready / needs revision; on needs revision -> 4b: C fixes exactly the listed points, same closer re-checks only those |
| 5 | skipped (internal document) | -- | -- |

After ship-ready: C promotes the table to `docs/landscape-v1.md` (living copy with a status column), updates
handoff + CLAUDE.md pointers, commits, and hands H the decision table in chat. Then this folder is frozen.

## Pre-committed rules (set before any data exists -- C arbitrates by these, not by taste)

- **Merger** = C (external merger variant). C writes no Round 1 review. C's prior is declared in the merge header
  and excluded from tags; merger-added content is tagged `[merger]`.
- **Closer** = the seat least represented in the merge (count of items tagged with that seat's letter); tie -> A.
- **Dispositions are exclusive:** every candidate gets exactly one of BUILD (full spec: what, size, gate, cost),
  EVALUATE (scoped first step + pass/fail gate + size estimate), MONITOR (named trigger that would flip it),
  CLOSED (reason + the numbers). An open-ended "maybe" is a gate failure.
- **Caps, no word caps:** per seat max 12 candidate rows; of those max 3 BUILD and max 4 EVALUATE. Everything else
  is MONITOR or CLOSED. Evidence is excluded from any length consideration.
- **Every number carries its provenance:** A -> URL + access date (primary sources outrank blogs and threads; a
  venue's own fee page / API outranks a tweet); B -> command + number + time window, or tx/fill id; R -> `file:line`
  + quote, or an explicit arithmetic line.
- **`flips if:`** on the verdict and on every BUILD / EVALUATE / CLOSED row, each saying whether the flip is a fact
  someone can look up, a measurement B can make, or a preference only H can state.
- **`[DISPUTED]` survives only if** both Round 2 flip-checks came back "no"; otherwise the merge adopts the side
  whose `flips if:` was met. Preference disagreements (risk appetite, capital, time) are not disputes: they go to
  the decision table for H.
- **Red-team material** that no voting seat also raised goes to the merge's "questions / checks" section, never
  into a BUILD or EVALUATE row's justification, tagged `[redteam]`.
- **Known-dead is not a finding:** S3 (PF 0.48 on 839 test trades), S4 grid on BTC (9 configs, all negative,
  `docs/s4-grid-backtest-analysis.md`), S2 (inverts between windows), S7 (-$3). A seat may re-open one only with
  a *new* argument and the numbers; "it might work with different parameters" is CLOSED, not EVALUATE.
- **Independence guard:** Round 1 seats never open the other seat's file or `REDTEAM.md`; Round 2 seats never open
  `NOTES_FROM_*`. C reads seat files only after their gate.
- **No prod changes during the run.** No deploy, no `.env` edit, no strategy toggle, no key rotation, no manual
  trade, until the campaign is closed. B's numbers must stay a stable baseline. (The pending Supabase key rotation
  waits; accepted by H on 2026-11-03.)
- **Detection test:** one lead C already knows is withheld from every brief. If neither voting seat reports it by
  Round 2, C adds it at Round 3 tagged `[merger]` and records the miss here.

## C's read-never list (before the named gate)

`REVIEW_A.md` / `REVIEW_B.md` / `REDTEAM.md` before H reports Round 1 done; `NOTES_FROM_*` before Round 2 done.
Flash's `docs/collab/optim-v2/REVIEW_*.md`, `NOTES_*`, `REDTEAM.md` ever (they would anchor the merge on Flash's
findings; the templates and `MERGED_BACKLOG.md` as a format example are enough).

## Partial-coldness note (recorded, not fought)

Every seat runs in the TradeKit workspace and inherits `CLAUDE.md` plus the auto-memory index. `CLAUDE.md` names
the strategies, their status, the lookahead bug, and the bankroll; so no seat is fully cold on "what we have".
That is acceptable for a landscape pass (the baseline is not the secret); it is recorded here so the merge does
not count a `CLAUDE.md` fact as an independent finding.

## File map

```
docs/collab/landscape-v1/
  RUN.md                    this file (C keeps the gate log below current)
  PASTES.md                 H's paste sheet, in order, one checkbox per paste
  BRIEF_A.md  BRIEF_B.md  BRIEF_R.md          Round 1 briefs
  BRIEF_ROUND2.md                             Round 2 brief (both seats; [me]/[other] filled by the paste)
  BRIEF_ROUND4.md                             Round 4 brief (closer)
  REVIEW_A.md  REVIEW_B.md  REDTEAM.md        Round 1 outputs (placeholders until written)
  NOTES_FROM_A.md  NOTES_FROM_B.md            Round 2 outputs
  MERGED_CANDIDATES.md                        Round 3 (C)
  MERGE_NOTES_FROM_A.md | _B.md               Round 4 (closer)
  scripts/B/                                  B's throwaway read-only scripts (not committed by B)
```

## Gate log (C fills)

| When (UTC) | Gate | Result | Notes |
|------------|------|--------|-------|
| 2026-11-03 | setup | DONE S54 | folder, briefs, pastes, placeholders committed. Baseline frozen at: VPS account $103.15, no open position, bot on `c615ddb`, S1+S6, ↺47. Withheld lead recorded privately by C (not in any brief). C's prior: earlier today C pitched a grid to H before reading `s4-grid-backtest-analysis.md` (grid on BTC was killed in S29); C leans "S1 only"; C has seen the live fills since 09-23. |
| 2026-11-03 ~07:25 | R1 launch | A + B tabs pasted by H; **R spawned late** (H forgot to say "launched"; A and B had already finished) | Ordering deviation recorded: R started after REVIEW_A/B existed. No independence loss -- R reads code only and was given the brief path, not the seat files. C opened REVIEW_A/B only after H reported Round 1 done and after R was spawned. R running in the background at gate time. |
| 2026-11-03 | R1 gate | **PASS** both (R pending) | **A:** skeleton 1-10 in order; 12/12 rows, 0 BUILD, 3 EVALUATE; URL + access date on every number, relays from 403/404 pages flagged as unverified; `flips if:` on verdict (4 clauses, kind stated) and every row; 10 `[verify: B]` all within B's reach; used four web sub-researchers (within "the web"); did not read RUN.md (brief forbids docs/collab) and said so. **B:** skeleton 1-10; 12/12 rows, 2 BUILD, 2 EVALUATE; every number carries script + window; measured 07:25-07:40Z read-only (one `backtest_runs` row persisted, as the brief allows, tagged; Binance CSVs to scratchpad, not `data/`); 8 throwaway scripts in `scripts/B/`, secrets scan clean; 7 `[verify: A]`. git: only REVIEW_A/B modified + scripts/B untracked, no commits by seats. Baseline re-checked at gate: $103.15, 0 positions, 0 open orders. **Converged unprompted:** S1-on-a-basket (A2 = B6); S6 is the drag (A3 "fee-killed?" vs B1 "signal-dead, fees 7.8% of gross" -- a Round 2 flip-check candidate: A3's `flips if` looks met by B's numbers); cascade MONITOR (A5 = B7); scaling not a lever (A verdict = B8). **Partial blindness:** both cite CLAUDE.md (allowed). **Detection test:** not found by Round 1 -- B saw the symptom (0 `high` in 3,669 heartbeats, imminent 9-14 and debt $75-134M all `medium`) and filed it as `[verify: A]` #6, which A cannot answer; A's A5 does not mention the gate. Per rule: wait for Round 2, else `[merger]` at Round 3. **Out-of-scope P0 surfaced by B (B3):** VPS bot unable to place orders since 2026-10-18 09:45Z (`User or API Wallet 0x483dd… does not exist`; 16 signals + 4 manual commands, 0 orders). C confirmed read-only: `extraAgents` is `[]` on both masters. Timing matches Hyperliquid's 180-day API-wallet validity (approved ~April). Not a landscape candidate; goes to the merge as a blocking pre-condition `[B-only]`. **No prod change made** -- nothing is at risk (no position, no order path), and the fix needs H's MetaMask; bundled with the post-campaign maintenance window. C's own morning health check missed this (it read bar closes, dead-man, pm2 and fills, and attributed "no trade since 10-19" to the strategy). |
| 2026-11-03 | R done + gate | **PASS** -- REDTEAM.md 360 lines, 10/10 findings with `file:line` + quote + trigger + blast radius + gate; "could not break" list (9 items, incl. "S1 alone at $1k with trailing off"); 8 silent failures; 12 questions. Read code only; nothing committed; R's hand-back to C was the line count + counts only (no finding text), as instructed. | **Partial coldness:** R cites "the S53 fix" and "`[assumed from brief]`" -- session tags come from code comments or inherited CLAUDE.md; recorded. **Citation error:** F1 cites `aggregator.ts:389`; the file is 68 lines, the line is `aggregator.ts:40`. **C spot-checked F1 (load-bearing for B's evidence base) and confirms it as a code fact:** `candle-consumer.ts:219-236` pushes the just-opened 15m bar (first tick) into the buffer *then* calls `computeAndEmit`; `aggregate()` drops the final bucket only when `bucket.length < expectedBars`, so at the last slot of each higher-TF bucket (xx:45 for 1H; 03:45/07:45/… for 4H; 23:45 for 1D) the bucket counts as complete with a provisional close. Also `last15m` (`:262`) is the just-opened bar, not the just-closed one. CLAUDE.md's "the live bot is not affected -- `aggregate()` drops an incomplete final bucket" is wrong for the last slot. Frequency depends on where the S1/S6 wall-clock gates land (R: ~1 in 4 S6 evals, ~1 in 16 S1 evals, `[assumed uniform]`); measurable from `s6-diag`/`s1-diag` timestamps (R question 2). Out of landscape scope; per rule it goes to the merge's checks section `[redteam]` with C's verification tagged `[merger]`, and to the handoff as a live-bot bug to fix after the campaign. F2 (naked window when `setStopLoss` throws) = the already-listed "stop-placement retry NOT IMPLEMENTED" untested path, not new. F4's $100 sizing arithmetic assumes the code default `LEVERAGE_MULT=0.25`; the VPS logs `1x`, so B's capacity table (1.0x) stands. |
| 2026-11-03 (H: Round 2 done) | R2 gate | **PASS** both | **A:** 8 sections, tables, 7/7 `[verify: A]` answered (6 = `cannot`, Flash code out of reach -- but A connected the in-repo spec `docs/tradekit-strategy-ideas-from-flash.md:62-65` to B's numbers), 11 flip-checks: A3 **yes** (→ CLOSED, kill S6), rest no; withdrew its R1 matrix-wording correction after B's extended window. **B:** 8 sections, 10/10 `[verify: B]` answered with number + window (new reads 08:40-09:30Z, non-persisting replays `bt_oos_trades.ts` / `oos_summary.py`, alt CSVs in scratchpad), flip-checks: B2 **yes** (→ S1 MONITOR, "13 BTC trades most likely noise"), B6 → CLOSED (ran both its own gate and A's pooled gate: **FAIL**, pooled S1 test PF 0.79, SOL/XRP negative both windows), rest no. Neither opened the other's NOTES or REDTEAM. git: only NOTES_FROM_A/B modified + 2 new scripts (secrets scan clean). **Disputes for the merge:** (1) A's funding-correction premise (backtest charges Binance funding) is wrong per B's code read -- OOS scripts charge a flat 10.95% APR (`engine.ts:45`); B measured the real Hyperliquid series anyway: S1 test PF 1.30 → 1.22 with real funding, flip (c) not met → adopt B, no `[DISPUTED]`. (2) A disputed B6's per-asset gate as too small; B ran A's pooled gate too; both fail → moot, CLOSED under A's own `flips if`. (3) B disputes "keep S1 as incumbent" because the bot cannot trade -- a framing point for the merge, not a disposition dispute. **Converged:** S1 MONITOR/default (A1 = B2 after flip), S1 basket CLOSED (A2 = B6), S6 fee row CLOSED (A3 = B9; S6 test PF 1.05 even at zero fee), cascade MONITOR (A5 = B7, 1 of 4 episodes reached -3%), scaling CLOSED. **Concessions:** A → B3, B4, B1, B2 crowd-out, B11, B9/B10; B → A4 (EVALUATE, 98.5% idle), A3-as-question, A6/A7 MONITOR. **Detection test: PASS at Round 2** -- the withheld lead (Flash's `high` gate never fires though its stated conditions are met) was found by A in answer 6, building on B's R1 symptom; C adds only the May-June 2026 count (27 heartbeats met both conditions, S53 parse) as `[merger]` context. **Side result:** S6 on XRP positive in both windows (1.10 / 1.18, n=399/235) -- B calls it chance-sized; merge decides disposition. |
| 2026-11-03 | R3 merge | `MERGED_CANDIDATES.md` written by C (283 lines): §0 blocking pre-condition, verdict, per-strategy table (S1 MONITOR, S6 KILL, S5 MONITOR, rest CLOSED), O2, 15 candidate rows (BUILD 2: C4 paper ledger, C5 write path; EVALUATE 2: C6 idle yield, C8 S6-on-XRP; MONITOR 4; CLOSED 7), 10 questions/checks, 10 decisions, flip table, dispute log, closed list, 3 recommendations | Prior declared in the header; merger content tagged `[merger]` (8: extraAgents verification, F1 code check, C8 gate design, May-June `high` count, restart bundling, ×3 small). Red-team material confined to §6 (8 `[redteam]`), none in a BUILD/EVALUATE justification. 0 `[DISPUTED]` rows (3 grep hits = legend + two "none" lines). Dispute rule applied once (A's funding premise → B's code fact + measurement). **Tag count (mechanical grep):** `[BOTH]` 20, `[B-only]` 16, `[A-only]` 11 → **closer = A** (least represented; not a tie). |
| 2026-11-03 | R4 named claims (for A) | handed to H in the paste | 1. §0 / C5 `[B-only]`: A's R2 §3 concession is quoted as "nothing else on either list matters until this is fixed" -- confirm wording and that A's R1 had no such row. 2. C2 `[BOTH]`: A2 and B6 are independent R1 rows; CLOSED rests on A's own R1 `flips if` ("fails the §4 gate") being met by B's R2 §4 measurement, not on a concession. 3. C3 `[BOTH]`: A3 (EVALUATE) and B9 (CLOSED) are both R1 rows; A's R2 §5 flip-check on A3 reads "yes in substance". 4. S6 KILL `[B-only]` (§2 and verdict): A's R1 had no S6-kill row (A1 says "+S6 pending A3"); A's concession is R2 §3. 5. C6 `[A-only]`: B's R1 had no idle-yield row; B's concession is R2 §3 ("EVALUATE, 98.5% idle"). 6. C8 `[B-only]`: this is a B R2 §4 side result, not an R1 finding; the gate is tagged `[merger]`. 7. Q2 `[BOTH]`: B R1 §5 symptom + `[verify: A]` 6, A R2 answer 6; the only `[merger]` content is the May-June count. 8. Q3 `[BOTH]`: both seats' R2 §8 caveats say the alt failure may measure the stop, not the rule. 9. Dispute 1 (§9): B R2 §1 corrects A's premise citing `engine.ts:45`; A's R2 §5 flip (c) is "no". 10. Verdict clause "S1 is a zero-cost default, not an edge `[BOTH]`": A1 MONITOR (R1) and B2 WATCH (R1) → B flipped to MONITOR in R2 §5 -- is `[BOTH]` right, or is it `[A-only]` + a B flip? 11. §3 "where the flow went" is `[A-only]` throughout except the marked costs line. |
| 2026-11-03 (H: Round 4 done) | R4 gate | **NEEDS REVISION** (7 numbered points) -- 11/11 named claims checked: 8 hold, 3 wrong (6: C8 is R2 material, not `[B-only]`; 7: Q2 is `[B-only]` + A's R2 answer, not `[BOTH]`; 8: Q3's "the stop" is B's caveat only -- A's caveat is about vol-targeted baskets). Also caught: C8's gate was unreachable (XRP train PF 1.10 < 1.15), the pair count (9 not 7) and a false "only pair positive in both windows"; A9/A12 flips collapsed into C11/C13; verdict flips (a)/(b) are `[merger]` thresholds, A's flip (d) dropped; HLP mis-stated as not joinable; "only positive number" should read "only *sure*"; `[merger]`/`[redteam]` content (Supabase rotation, Q1 fix, 180-day hypothesis) riding untagged in §11 and C5; A's spot-vs-futures data-source dispute unrecorded; §3 costs line used B's R2 funding figure without saying so. | C fixed exactly the 7 points (+ the two one-line nits the closer tied to C1 and C14): C8 → **CLOSED** with the pre-registered replay as its flip (`[B R2]`, design `[merger]`); Q2 → `[B-only]` + `[A R2]`, runbook and "C7 undecidable" tagged `[merger]`; Q3 → `[B R2]` with A's basket caveat in words, ATR design `[merger]`; verdict S6 clause split (`[B-only]` signal-dead / `[BOTH]` PF 1.05), HLP sentence corrected, "only *sure*", flips (a)/(b) tagged `[merger]`, (d) restored → C6; C11/C13 flips split per A8/A9 and A11/A12 (flip table too); C5 + §11 item 1: rotation `[merger]`, Q1 fix `[redteam]`+`[merger]` and moved to a separate deploy after C5's gate, B's "if it fails" text restored with the expiry hypothesis tagged `[merger]`; §9 item 7 added (spot vs futures, unresolved, non-blocking) and §3 cites the R2 funding figure. Legend gained `[A R2]`/`[B R2]`. Counts now BUILD 2 / EVALUATE 1 / MONITOR 4 / CLOSED 8. Nothing else touched. |
