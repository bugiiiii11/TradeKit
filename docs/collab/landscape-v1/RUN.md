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
