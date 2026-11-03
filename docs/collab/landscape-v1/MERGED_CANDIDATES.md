# MERGED_CANDIDATES -- Landscape Campaign v1, Round 3 (coordinator / external merger)

**Written:** 2026-11-03 by C (session S54). **Inputs:** `REVIEW_A.md`, `REVIEW_B.md`, `NOTES_FROM_A.md`,
`NOTES_FROM_B.md`, `REDTEAM.md` (non-voting). C wrote no Round 1 review.

**Tags.** `[BOTH]` = both voting seats had the item in Round 1 independently. `[A-only]` / `[B-only]` = one seat's
Round 1 finding; a Round 2 concession by the other seat is noted in words, not by tag. `[redteam]` = raised only by
seat R; such material sits in section 6 (questions / checks) and justifies no BUILD or EVALUATE row. `[merger]` =
content C added (a verification, a gate design, context from C's prior). `[DISPUTED]` = none survived.

**C's declared prior (excluded from tags).** Before this campaign C had: pitched a grid to H on 2026-11-03 before
reading `docs/s4-grid-backtest-analysis.md` (grid on BTC was killed in S29); leaned "S1 only, build nothing until a
candidate clears a pre-set gate"; seen the live fills since 09-23 (14 trips, 2W/12L, -$18.17) and attributed the
absence of trades since 10-19 to the strategy -- which B showed to be wrong; read CLAUDE.md and the handoff, which
hold the cascade `high`-gate lead withheld from the briefs. At R's hand-back C received only a line count and finding
count. C read `REDTEAM.md` after the Round 1 gate and spot-checked its F1 in the code (section 6, Q1).

**Detection test.** The withheld lead (Flash's `high` gate never fires although its stated conditions are met most
hours) was found at Round 2: B logged the symptom in Round 1 (955/955 `medium` with imminent 9-14 and debt
$75-134M) and tagged it `[verify: A]` #6; A answered it from the in-repo spec
(`docs/tradekit-strategy-ideas-from-flash.md:62-65`). Pass. C adds the May-June 2026 count as `[merger]` context
in Q2.

---

## 0. Blocking pre-condition (out of landscape scope; nothing below is actionable until this is decided)

**P-1. The VPS bot has not been able to place an order since 2026-10-18 09:45 UTC.** `[B-only]` (A conceded R2:
"nothing else on either list matters until this is fixed"). Evidence (B R1 §1, B3; `sb_logs.ts`): 16 S6 signals
2026-10-19 16:00 → 11-02 15:30 and 4 `manual_trade` commands on 10-20 all failed with
`User or API Wallet 0x483dd… does not exist`; 4 trailing-stop modifies failed 10-18 19:45-20:45; the bot's own exit at
10-18 09:45 failed and the exchange-native stop closed the position 15 h later at a $0.62 worse price. Every health
signal (dead-man cron, WS loop, Discord digest, UI) read fine throughout. `[merger]` verification: `extraAgents` on
both master accounts returns `[]` (C, 2026-11-03); the timing matches Hyperliquid's 180-day API-wallet validity for an
agent approved in April 2026. No position and no open order exist, so nothing is at risk while it stays dead; the
fix needs H's MetaMask (approve a new agent), the VPS `.env`, a restart, and `test_connection.ts` + one $20
`test_micro_trade.ts` from the box (B3 first step). **The merge does not inherit a running incumbent** (B R2 §1).

---

## 1. Verdict

No strategy candidate survives measurement, and the only positive number either seat produced is yield, not an
edge. `[BOTH]` The live set is worth less than flat: 28 round trips since the 2026-08-20 restart, -$30.09 net,
PF 0.24, with S6 contributing 26 trips and -$27.47 `[B-only]`; the backtester reproduces the corrected
out-of-sample numbers to the cent and loses the same way on the live window, so the loss is the signal's, not the
plumbing's `[B-only]`. S6 is signal-dead, not fee-killed: at zero fee its test-window PF is 1.05 `[BOTH]` (A's
hypothesis, B's measurement, A conceded). S1 is positive in both windows on BTC (PF 1.30 test, 1.22 with real
Hyperliquid funding) on 13 trades, and the same unchanged rule fails on ETH/SOL/XRP (pooled test PF 0.79, SOL and
XRP negative in both windows) `[BOTH]` (A2 = B6, A's own `flips if` met) -- so 13 BTC trades are most likely noise
and S1 is a zero-cost default, not an edge `[BOTH]` (A1 MONITOR, B2 flipped to MONITOR). Costs, capacity and
scaling are not levers at any bankroll below ~$50k notional `[BOTH]`. Public evidence shows algorithmic takers on
Hyperliquid approximately break even after fees while market makers and HLP capture the intraday and cascade flow,
neither of which a $1k, 15-minute participant can join `[A-only]`. The cascade feed has never emitted the severity
S5 keys on `[BOTH]`.

**flips if:** (a) a strategy shows PF ≥ 1.2 in both windows on ≥ 100 out-of-sample trades it never saw
(backtest measurement, per the pre-registered split in Q9); (b) the paper ledger (C4) accumulates ≥ 60 S1 paper
trades at PF > 1.3 (live measurement, years away at ~9/yr unless more assets are added); (c) H states that
activity itself is the goal, in which case the question changes from edge to cost of play (preference).

---

## 2. Per-strategy verdict (what we have)

| strategy | verdict | evidence | tag |
|---|---|---|---|
| S1 (4H EMA trend, BTC) | **MONITOR -- zero-cost default if the bot trades at all; not an investment** | OOS test 13 trades PF 1.30 +$12.62 (1.22 / +$9.20 with real HL funding); train 19 / 1.53; inside S1+S6 only 7 of the 13 test trades occur (S6 holds the slot); live n = 1 (-$2.61); rule fails on 3 alts (section 4, C2) | `[BOTH]` |
| S6 (1H BBWP breakout, BTC) | **KILL** | live W1 n=26 PF 0.26 -$27.47, W2 PF 0.14; same-window backtest PF 0.38; extended OOS to 2026-10-31 PF 0.94 -$21.52 on 219; PF 1.05 at zero fee; fees 7.8% of gross loss | `[B-only]` (A conceded R2 §3, §5) |
| S5 cascade (webhook, `high`-gated) | **MONITOR** (feed alive, trigger never seen) | 955 heartbeats 09-24 → 11-03, 955 `medium`, 955 `ethereum`; impact max $1.28M; 4 independent debt-spike episodes, 1 of 4 followed by a -3% day; no published evidence that lending liquidations lead BTC | `[BOTH]` (A5 = B7) |
| S2, S3, S7, S4 grid | **CLOSED** (known-dead rule; re-measured, nothing new) | S3 PF 0.48 on 926; S6+regime 0.82; S2 1.17 but inverts; grid root cause unchanged | `[BOTH]` (A §10, B12) |

---

## 3. Where the flow went (O2) `[A-only]` unless marked

- **Short-horizon technical edge on BTC compressed with volatility, nobody captured it.** BTC daily realised vol
  4.13% (2021) → 2.24% (2025), 1.13%/day in Aug 2026 (K33 via spark.money 2026-09-08). Trend rules need large moves.
  Not joinable; the only lever would have been more independent bets -- tested in C2, failed `[BOTH]`.
- **Intraday flow goes to market makers, paid by retail.** Jia et al. AFT 2026 (to 2026-06-30): makers +$208M,
  algorithmic takers ≈ break-even, front-end traders -$1.11B. Joining the maker side needs sub-second quoting and
  ≥ 0.5% of venue maker volume for the first rebate. CLOSED.
- **Cascade flow goes to HLP and the liquidator backstop.** On 2025-10-10 ~$576M of $641M forced sales went to HLP;
  HLP trailing APR today -0.1%, TVL down ~75% from peak. Joinable as a depositor; it is crash-concentrated yield,
  currently below lending. CLOSED (C12).
- **Funding carry went to basis funds and compressed** (sUSDe 37.7% Mar 2024 → 4.76% 90d mean; CME 3-month basis
  ~2%). DIY on Hyperliquid nets ~5-6%/yr on BTC at $500, portfolio margin closed below $10k account value. CLOSED
  (C11).
- **Our own costs, measured `[B-only]`:** taker 4.32 bps on 65/65 fills (referral 4% applied, staking 0); entry
  slippage +0.24 bps, stop slippage +1.65 bps, 4.5 s bar-close → fill; funding net +$0.08 over W1; fees + funding
  = 4.23 bps of turnover. At $151 notional the book (6.9-7.2 BTC at the touch, 0.13 bps spread) is irrelevant.

---

## 4. Candidate table (O3 / O4)

Exactly one disposition per row. `flips if` kinds: **L** = look-up fact, **M** = measurement, **P** = owner
preference.

| id | candidate | kind | what the evidence says | disposition | flips if | tag |
|---|---|---|---|---|---|---|
| C1 | **S1-only live** (`ENABLED_STRATEGIES=S1`) | strategy | positive both windows on BTC, 13 test trades; fails to generalise (C2); ~9 trades/yr; costs ~$3/yr in fees; S6 crowd-out removed | **MONITOR** -- the default after P-1 if H wants a live bot; no investment | (M) 20 live S1 trades at PF < 1.0 → stop; (M) C4 paper S1 ≥ 60 trades PF > 1.3 → upgrade to EVALUATE size | `[BOTH]` |
| C2 | **Same S1 rule on a basket (ETH, SOL, XRP)** | strategy | measured R2 (B, unchanged rule, 3% stop, 10x; Binance data 2022-02 → 2026-10): ETH train 1.08 / test 1.20; SOL 0.59 / 0.32; XRP 0.83 / 0.50; pooled 4-asset test n=50 PF 0.79 -$46.66 DD 18.6% -- fails B's gate and A's pooled gate | **CLOSED (failed)** | (M) a re-run with a volatility-scaled stop, pre-registered before it is run, passes A's pooled gate (see Q3; this is the one caveat both seats left standing) | `[BOTH]` (A2 = B6; A's `flips if` met by B's R2 measurement) |
| C3 | **Cut S6's fee drag** (maker entries, staking discount, 0-fee venue Lighter, tier) | strategy + venue | S6 test PF 0.94 → 1.01 at maker fee → 1.05 at zero fee; effective taker already 4.32 bps; Wood staking ($835 of HYPE) saves ~$0.003/trade; tier 1 needs $5M/14d; maker rebate needs 0.5% of venue maker volume | **CLOSED** -- S6 is noise, so no fee path rescues it; and no fee path exists at our size anyway | (M) a strategy that is PF ≥ 1.2 at zero fee but < 1.1 at taker (then maker entries become a question) | `[BOTH]` (A3 EVALUATE → CLOSED by its own flip; B9 CLOSED) |
| C4 | **Paper-execution ledger** (every risk-gated signal → `paper_trades` row with the engine's fill/exit model; backfill from `s1-diag`/`s6-diag` + `market_snapshots`) | tooling | 52 S6 SIGNAL lines logged since 08-20 vs 26 traded; 16 signals with no P&L since P-1; entry fill vs snapshot close +0.24 bps, so paper ≈ live within ~$0.05/trade; also fixes the Supabase `trades` overstatement (+$3.41, gross and mark-based, one trip missing) | **BUILD** | (P) H will never run a strategy without money behind it (then the backtester is the ledger) | `[B-only]` (B4 + B11; A conceded R2 §3 "the right harness for alts") |
| C5 | **Restore the exchange write path + a write-path probe** (= P-1) | ops | see §0; today the error logs at `info` under `bot-vps`, the digest says ACTIVE, the dead-man watches only bar closes | **BUILD (blocking)** | (P) H decides the VPS is signal-only -- then say so and stop the UI/Discord claiming LIVE | `[B-only]` (A conceded) |
| C6 | **Idle-USDC yield** (lend the never-used balance; Hyperliquid Earn 3.46% now / 4.79% 30d mean, DefiLlama 2026-11-03) | passive | margin use is 1.45% of bankroll time-weighted, 4.99% while in a position, peak $19.25 → ~98.5% idle; S1's expected ~$2/yr at $103 vs ~$4/yr lending; ~$21 vs ~$36 at $1k. **Yield, not edge** | **EVALUATE** -- a docs look-up, no code: does lent USDC back perp margin; redemption latency; can only the master wallet move it; any loss event | (L) lent USDC cannot back margin and needs manual moves per trade → MONITOR; (P) H declines protocol-lending risk → CLOSED | `[A-only]` (A4; B conceded R2 §3) |
| C7 | **S5 cascade graded on our side** | strategy (event) | feed is an hourly cron, static-ish (140 distinct tuples in 955 hours); `high` never arrived; 4 independent episodes in 41 days, 1 reached -3%; literature: forced selling is 88% done within 30 min of onset, no metric warned consistently across 7 cascades | **MONITOR** | (M) first `high`/`critical` arrives; (M) ≥ 30 non-overlapping debt-spike episodes with +1h → +8h returns measured, ≥ 3 leading a ≥ 3% drop by ≥ 1h (A's test); plus Q2 answered | `[BOTH]` (A5 = B7) |
| C8 | **S6 unchanged on XRP** | strategy | side result of C2's replay: XRP S6 train 1.10 / test 1.18 (n=399 / 235), the only alt × rule pair positive in both windows out of 6; BBWP is self-normalised so it fires everywhere (R F7, `[redteam]` caveat in Q5) | **EVALUATE** -- cheap, with a pre-registered gate | (M) gate in §5 fails → CLOSED; (M) passes → paper-trade only via C4 on a second feed, no money | `[B-only]` (B R2 §4 side result; gate design `[merger]`) |
| C9 | **S1 on HIP-3 non-crypto perps** (gold, oil, SP500) | strategy + market | fees 2× native unless growth-mode; weekend oracle anchored to Friday close; deployer halt risk; needs symbol plumbing and external history | **MONITOR** | (M) a trend rule is first shown to generalise (C2 or Q3 passes) **and** (L) a target market is in growth mode | `[A-only]` (A6) |
| C10 | **Regulated EU fallback venue** (Kraken EEA, OKX Europe) | venue | 5/2 bp vs Hyperliquid 4.5/1.5; KYC; ESMA 2026-02-24 puts EU-firm perps for retail under CFD measures; value is venue diversification only (Drift hack 2026-04-01, Binance $6.3B 2026-10-29) | **MONITOR** | (L) Hyperliquid solvency / withdrawal incident; (P) H's legal position requires a regulated venue | `[A-only]` (A7; B: outside reach, MONITOR) |
| C11 | **Funding capture** (DIY spot/perp basis on Hyperliquid; cross-venue arb) | strategy (carry) | net 5-6% APR on $500 BTC (HYPE 8%, liquidation risk at 2-3x); cross-venue spread +3.7% APR mean, no 7-day window covered round-trip fees, 19-day break-even; portfolio margin closed < $10k; engine has no spot leg or hedged pair | **CLOSED** | (L) portfolio margin opens to small accounts **and** BTC funding sustains well above the 10.95% floor | `[A-only]` (A8, A9) |
| C12 | **HLP, user vaults, copy trading** | passive | HLP trailing APR -0.1%, TVL $150M (peak $604M); 3,063 user vaults, no survivorship-adjusted stats; manager bet, not edge | **CLOSED** | (L) HLP 90-day APR above the lending rate for a full quarter | `[A-only]` (A10) |
| C13 | **Funding / OI / exchange-flow extremes; listing events** | strategy (signal / event) | no dated out-of-sample study at 1h-1d with costs; data feeds $29/mo+; our S7 -$3/26mo; listings: 15m clock arrives after the pop, Upbit median day-1 gain 42% → 10% | **CLOSED** | (L) a published out-of-sample result at 4h-1d with costs on 2024+ data | `[A-only]` (A11, A12) |
| C14 | **Bankroll top-up as a lever** | capital | fee rate, slippage, stop slippage, latency all flat in size below ~$50k notional; scaling multiplies -$1.08/trade; S6 can size down to $25, S1 to $20 | **CLOSED** | (M) a configuration with positive live expectancy exists (C1 flip (M) up, or C8 passes) | `[BOTH]` (A §7 #1, B8) |
| C15 | **BTC grid, S2, S3, S7, S6+regime** | strategy | known-dead rule; re-measured on the extended window, nothing new (§2) | **CLOSED** | -- (re-open only with a new argument and numbers, per RUN.md) | `[BOTH]` |

Counts: BUILD 2 (C4, C5), EVALUATE 2 (C6, C8), MONITOR 4 (C1, C7, C9, C10), CLOSED 7.

---

## 5. BUILD and EVALUATE rows, expanded

### C5 -- restore the exchange write path + probe (BUILD, blocking) `[B-only]`
- **Scope:** H approves a new agent wallet for the VPS master in the Hyperliquid UI (MetaMask); the new key goes
  into the VPS `.env` (one of three copies -- CLAUDE.md rule); `pm2 restart`; `test_connection.ts`, then one $20
  `test_micro_trade.ts` from the box. Then a write-path probe: at startup and every 4 h call something that needs
  the agent signature (B: `userFees`, or a `modify` of a resting far-away order), and alert `#errors` on
  `does not exist` / `ApiRequestError`; raise the log level of that error from `info`. Do it in the same restart as
  the pending Supabase key rotation and the strategy switch (C1), so the bot restarts once. `[merger]` bundling.
- **Gate:** one live entry with `[Orders] Market …` + `Stop-loss set` logged and visible in `userFillsByTime`
  within 10 s of a bar close; fail = any `ApiRequestError` on the next 3 signals.
- **Cost:** ~1 h of H at the keyboard, $0.02 of test fees; probe ~2 h code.
- **If it fails:** the agent-wallet lifecycle (180-day expiry) needs a calendar entry and a checklist, not a
  sentence in CLAUDE.md.

### C4 -- paper-execution ledger (BUILD) `[B-only]`
- **Scope:** in `main-headless.ts`, when a signal passes the risk gate, write a `paper_trades` row (entry =
  snapshot close, the strategy's stop, the engine's exit rules, fee and funding model) regardless of whether a real
  order is placed; backfill from the 52 S6 and 7 S1 diag lines since 2026-08-20; add a fills-based reconciliation
  so the dashboard stops overstating P&L (B11, +$3.41 on -$30.09). Keep `s6-diag` logging on after S6 is disabled
  so S6 keeps producing paper trades.
- **Gate:** on the 28 overlapping live trips, paper net within ±$0.30/trade of fills net (slippage says ±$0.05).
  Fail = systematic sign difference on > 3 trades.
- **Cost:** 4-6 h, zero exchange risk.
- **If it fails:** the engine's exit model does not match live trailing exits, which would also weaken every
  live-vs-backtest comparison in this campaign (B's own caveat).

### C6 -- idle-USDC yield (EVALUATE) `[A-only]`
- **First step:** a docs look-up (no code, ~0.5 session): whether supplied USDC counts toward perp margin under
  the Unified Account; redemption latency; whether the trade-only agent can move it (A expects not → owner-signed
  moves on top-ups only); rate history and loss events. A relayed the DefiLlama figures via a sub-researcher and did
  not open the pool page -- open it.
- **Gate:** 90-day mean ≥ 3% **and** (lent USDC backs margin directly, or H accepts manual moves with a fixed
  unlent float that covers 5% margin per trade). Fail = slow redemption or any loss event in the pool's history.
- **Cost:** 0.5 session plus H's risk decision (D4).
- **If it fails:** nothing about edges; the hurdle rate (~4% on tied-up capital) stays.

### C8 -- S6 unchanged on XRP (EVALUATE) `[B-only]`, gate `[merger]`
- **First step (~1-2 h with B's scripts):** before running anything, commit this gate. Replay the unchanged S6 rule
  (BBWP > 50 from < 20, EMA21 direction, 2% stop, 8x) on three more pre-named Binance-futures assets with ≥ 55
  months of history (proposal: DOGE, ADA, LINK -- chosen for history length and Hyperliquid liquidity, not for any
  look at their charts), same train/test split as `backtest_oos.ts`, plus XRP extended to the data end.
- **Gate:** XRP stays PF ≥ 1.15 in both windows **and** at least 2 of the 7 alt × rule pairs tested so far (ETH,
  SOL, XRP × S1/S6, plus the three new S6 runs) pass PF ≥ 1.2 in both windows. One hit in seven is the chance rate
  R's F7 warns about; two is the minimum that is not. Pass → paper-trade S6-XRP through C4 on a second candle feed
  (that feed is a build: R's silent-failure #1/#2 apply, see Q5). Fail → CLOSED, and the "self-normalised BBWP fires
  everywhere" explanation stands.
- **Cost:** 1-2 h backtest; if it passes, the second-feed paper build is M (multi-coin WS, dead-man per feed).
- **If it fails:** no alt rescues S6; the 1-in-6 XRP hit was selection.

---

## 6. Questions and checks (not candidates; red-team material lives here)

| # | item | source | what to do |
|---|---|---|---|
| Q1 | **The live bot reads a higher-TF bar one 15m slot early with a provisional close.** When a new 15m bar opens, `candle-consumer.ts:219-236` pushes its first tick into the buffer *before* aggregating; `aggregator.ts:40` drops the last bucket only when it is short by count, so at xx:45 (1H), 03:45/07:45/… (4H) and 23:45 (1D) the bucket counts as complete. `snap15m` (`:262`) is also the just-opened bar. CLAUDE.md's "the live bot is not affected" is wrong for the last slot. Frequency depends on where the S1/S6 wall-clock gates land. | `[redteam]` F1; **verified in code by C** `[merger]` (R's citation `aggregator.ts:389` is wrong, the file has 68 lines) | Measure: share of `s6-diag`/`s1-diag` rows timestamped at :45 slots (R question 2). Fix in the maintenance window: aggregate `buffer.slice(0, -1)` and gate S1/S6 on the higher-TF bar timestamp changing, not wall-clock elapsed (also closes R's F3, the 4h15m drift). Then re-check that live entries still match the backtester's. |
| Q2 | **Flash's `high` gate never fires although its stated conditions are met.** Spec in repo: 10+ positions at HF 1.01-1.05, imminent debt > $50M (`docs/tradekit-strategy-ideas-from-flash.md:62-65`). B's data: imminent ≥ 12 in 501 of 955 hours, debt $75-134M, 955/955 `medium`. | `[BOTH]` (B R1 symptom + `[verify: A]` 6; A R2 answer 6). `[merger]` context: the S53 parse of the old-format rows found 27 heartbeats in May-June 2026 meeting both conditions, all `medium`. | Ask Flash (runbook Task C has a paste-ready message): does the shipped mapping gate on `aggregate_debt_usd` or on something else, and has `high` ever been emitted anywhere? C7 cannot be decided without it. |
| Q3 | **Does "S1 fails on SOL/XRP" measure the rule or the 3% stop?** Alts have 1.5-2× BTC's volatility; the studies A cites used volatility-targeted baskets, not a fixed rule on three alts. | `[BOTH]` (A R2 §8, B R2 §8 -- both seats' surviving caveat) | Decision D5: either pre-register one replay with an ATR-scaled stop (e.g. stop = k × ATR(4H) with k fixed from BTC's 3%, committed before the run) or leave C2 CLOSED. Not tuning per coin. |
| Q4 | **Naked-position windows** when `setStopLoss` throws after a fill, or `closePosition` throws after the stop is cancelled. | `[redteam]` F2 = the already-listed "stop-placement retry NOT IMPLEMENTED" untested path in CLAUDE.md | Known; fix order on exit (reduce-only close first, cancel stop after), register the position before placing the stop. Maintenance list, not a candidate. |
| Q5 | **Multi-asset seams and selection traps.** BTC is assumed in eight places (context singleton, `lastSetLeverage`, account filters, WS/REST/CSV literals, `insertClosedTrade` symbol, kill switch closes BTC only); BBWP is self-normalised so S6 fires at the same rate on every coin; the 30-trade OOS verdict pushes selection toward the noisiest alt; a second feed can mask the BTC loop dying (dead-man matches any `[WS] Bar closed`; heartbeat resets on any message). | `[redteam]` F7, F9, silent-failure #1, #2, #6 | Applies if C8 passes: parameterise coin in the context and account layers first, dead-man per feed, kill switch must close a non-BTC position in a test before any live alt trade. Pre-register split dates and asset lists (Q9). |
| Q6 | **Desktop master `0x3a8a…4C46` traded $1.16M across 19 coins (1,324 fills, 2026-04-10 → 10-30, fees $465)** -- above the $100k sub-account unlock. The VPS account's lifetime volume is $23k. | `[B-only]` R2 answer 5, `[verify: H]` | H: who or what traded that account? If it is H's own manual trading, sub-accounts are available there (would let a second strategy run without sharing a position), and the question of whether that activity is itself a strategy belongs in the decision table (D7). |
| Q7 | **`trade_log.json` open records accumulate**: `reconcilePositions` writes `insertClosedTrade` but never `logTradeClose`, and hydration's `find` returns the oldest matching record, so a restart can attach a months-old strategy/timestamp to a live position. | `[redteam]` silent-failure #5 | Measure: count `exit_price: null` records on the VPS (`R` question 9). Fix with C5's restart if non-zero. |
| Q8 | **Weekend 08:18-09:36 UTC 502s** from `api.hyperliquid.xyz` (10 episodes in 75 days, each recovered in 1-4 min). | `[B-only]` R1 axis 8; A R2 answer 7: no documented window | Harmless so far; ask in Hyperliquid's Discord if it ever lengthens. |
| Q9 | **Backtest hygiene before any new sweep:** the OOS scripts charge a flat 10.95% APR funding (`engine.ts:45`) not the Binance CSV; real Hyperliquid funding was 7.44% APR in the test window and 19.5% in train; `SLIPPAGE_BPS = 0` (measured within $0.01/trade of truth, so acceptable); split dates and `--timeframe`/`--leverage` are free CLI flags. | `[B-only]` R2 §1 and answer 2 (corrects A's premise, A's flip (c) not met); `[redteam]` F9 | Commit the split date (train → 2025-06-30, test 2025-07-01 →) and the asset list in a config before C8 or Q3 runs; add a Hyperliquid-funding option to the engine (B has 29,943 `fundingHistory` rows from 2023-05-12). |
| Q10 | **Discord alerts can vanish silently** (non-OK, non-429 responses swallowed), and the S5 sender reads `✓` if it never connected since restart. | `[redteam]` silent-failure #3, #4 | Maintenance list: log a line on alert failure; flag `lastAt === 0` after 2 h. |

---

## 7. Decisions for H (preferences, not findings)

| # | decision | the numbers | options |
|---|---|---|---|
| D1 | **Is the VPS meant to trade at all?** | 0 of 20 attempted orders since 10-18; nothing at risk meanwhile | (a) yes → C5 now, bundled with the key rotation; (b) signal-only → say so, stop the UI/Discord claiming LIVE, skip C5 |
| D2 | **Strategy set after C5** | S6 -$27.47 live, PF 1.05 at zero fee; S1 +$12.62 OOS on 13 trades, fails on alts | (a) S1 only (both seats' default); (b) nothing live, paper only via C4; (c) keep S6 -- no seat supports this |
| D3 | **Top-up** | size changes nothing but the magnitude of -$1.08/trade | no top-up for trading (both seats); a top-up for C6 is a yield decision |
| D4 | **Protocol-lending risk on idle USDC** (C6) | ~98.5% of the balance idle; ~$4/yr at $103, ~$36/yr at $1k | accept at some share / decline |
| D5 | **Spend 1-2 h on Q3 (vol-scaled stop replay) and/or C8 (XRP + 3 alts)?** | each a pre-registered backtest, no money | yes / no; if yes, C commits the gates before running |
| D6 | **Ask Flash about the `high` gate** (Q2) | 27 + ~500 heartbeats met the stated conditions, 0 `high` | send the runbook message / drop C7 to CLOSED |
| D7 | **The desktop account's $1.16M of volume on 19 coins** (Q6) | above the sub-account unlock; VPS has $23k lifetime | H explains; decide whether manual trading is a track of its own |
| D8 | **Second venue** | no return case; venue-risk case only (C10) | none now / open KYC at a regulated EU venue as insurance |
| D9 | **Residency, legality, tax** | ESMA 2026-02-24 binds EU firms; no source says an EU individual offends by using an offshore DEX; national law unconfirmed | H's own check |
| D10 | **Is activity itself a goal?** | S1 ≈ 9 trades/yr; S6 supplied activity and paid for it | if yes, the honest cost-of-play answer is paper (C4), not a live loser |

---

## 8. Flip table (one line per row, kind in brackets)

| row | flips if | kind |
|---|---|---|
| Verdict | (a) PF ≥ 1.2 both windows on ≥ 100 unseen OOS trades; (b) C4 paper S1 ≥ 60 at PF > 1.3; (c) H: activity is the goal | M / M / P |
| C1 | 20 live S1 at PF < 1.0 → stop; paper S1 ≥ 60 at PF > 1.3 → EVALUATE size | M |
| C2 | pre-registered vol-scaled-stop replay passes A's pooled gate (Q3) | M |
| C3 | a strategy that is ≥ 1.2 at zero fee and < 1.1 at taker | M |
| C4 | H never runs anything unfunded | P |
| C5 | H declares the VPS signal-only | P |
| C6 | lent USDC cannot back margin → MONITOR; H declines lending risk → CLOSED | L / P |
| C7 | first `high`; or ≥ 30 independent episodes with ≥ 3 leading a ≥ 3% drop by ≥ 1h; plus Q2 answered | M / M / L |
| C8 | gate in §5 fails → CLOSED; passes → paper via C4 only | M |
| C9 | a trend rule generalises AND target market in growth mode | M + L |
| C10 | Hyperliquid incident; or H's legal position | L / P |
| C11 | portfolio margin opens < $10k AND BTC funding well above the floor | L |
| C12 | HLP 90d APR > lending for a quarter | L |
| C13 | a published OOS result at 4h-1d with costs on 2024+ data | L |
| C14 | a configuration with positive live expectancy | M |
| C15 | new argument + numbers (RUN.md rule) | -- |

---

## 9. Dispute resolutions and concessions (provenance for the closer)

1. **A's funding correction (A R1 §1 #1, §8 #2: "backtest models Binance funding, Hyperliquid runs higher").**
   B (R2 §1) showed the premise is wrong from the code: the OOS scripts never load the funding CSV and charge a flat
   10.95% APR (`engine.ts:45`); the real Hyperliquid series was *lower* in the test window (7.44%). B measured the real
   effect anyway: S1 test PF 1.30 → 1.22, +$9.20. A's flip (c) ("funding makes S1 negative") not met. **Adopted: B.**
   Not `[DISPUTED]` -- a factual correction A could not see when writing its notes.
2. **B6's gate (B R1) vs A's pooled gate (A R1 §4).** A disputed B's per-asset n ≥ 10 as too small (A R2 §1). B ran
   both gates in R2 §4; both fail. **Moot; C2 CLOSED under A's own `flips if`.**
3. **A's R1 correction "S1 is not the only configuration positive in both windows".** True on the 444-day matrix
   (B R2 answer 10 confirms), false on the window extended to 2026-10-31. **A withdrew it (A R2 §5).** The merge uses
   the extended window.
4. **"Keep S1 as incumbent" (A R1 §1).** B (R2 §1) objected that the bot cannot trade. **Adopted as framing:** §0 and
   C1 "default after P-1", not "incumbent".
5. **Concessions honoured:** A → B1 (S6 kill), B2 crowd-out, B3, B4, B9/B10, B11 (A R2 §3); B → A4 EVALUATE, A3 as
   a question now closed with a number, A6/A7 MONITOR (B R2 §3). Each appears in §4 under the originating seat's
   tag with the concession in words.
6. **`[DISPUTED]` rows: none.** Preference disagreements went to §7.

---

## 10. Looked and closed (so nobody re-opens them without new numbers)

`[A-only]`: Hyperliquid tier 1 (> $5M / 14d); HYPE staking Wood ($835 for ~$0.003/trade); maker rebates (≥ 0.5% of
venue maker volume); builder codes (pay on others' flow); HIP-3 deployer (500k HYPE); points programme (none
active); portfolio margin (> $10k); Hyperps; HIP-4 outcome markets; Aster / edgeX (0.001 BTC minimum ≈ $77 >
our $41-52 notional); Paradex ($2.7M BTC/24h, Python-only); dYdX v4; Velocity (ex-Drift, deposits paused);
Binance (EEA exit, $6.3B hack); Bybit EU (no perps); Bitget / Gate; BitMEX (ceased); Vertex (wound down);
Variational (no API); Deribit; GMX v2 (8-12 bp round trip); Orderly; Pacifica; Extended (nearest miss, Python-only);
sUSDe / Liminal / Neutrl / Falcon (yield tokens, Resolv exploit precedent); liquidation heatmaps; "DeFi liquidations
lead BTC" (one study finds the reverse).
`[B-only]`: fee tier / maker entries ($2.5 saving over 73 days); slippage and latency (+0.24 / +1.65 bps, 4.5 s);
book depth; sizing floor ($25 / $20); OCI2 headroom (0.04% CPU, 346 MB, 20% disk); backtester reproduction
(191 / +$8.88 / PF 1.03 to the cent); trailing oid capture (127 modifies, 0 failures before P-1).
`[BOTH]`: S3, S2, S7, BTC grid, S6+regime (§2).

---

## 11. Recommendation (O5) -- written for H

1. **Decide D1, then fix the pipeline in one restart.** Approve a new agent wallet, update the VPS `.env`, rotate
   the Supabase key you already created, set `ENABLED_STRATEGIES=S1`, fix the bar-timing bug (Q1), and add the
   write-path probe (C5) so a dead key alerts within hours instead of weeks. About an hour of your time at the
   keyboard plus a short code change; nothing is at risk while you wait, because the bot cannot trade. If you would
   rather the VPS only signal, say so and we stop it claiming LIVE.
2. **Build the paper ledger (C4, 4-6 h) and judge every future idea on it.** It would already have given 52 S6
   observations instead of 26 and kept counting through the dead weeks. S6 keeps running on paper; S1 runs live at
   $103 as a zero-cost default, not as an investment.
3. **Do not fund a new strategy this quarter.** Every candidate measured here is break-even or worse, and the one
   positive number on either page is lending the ~98% of the balance the bot never touches (C6, your risk call,
   ~$4/yr at today's size). The two cheap backtests worth your "yes" are pre-registered and cost 1-2 h each: a
   volatility-scaled stop for the alt basket (Q3) and S6 on XRP plus three named alts (C8). Send Flash the
   `high`-gate question (Q2) -- two minutes, and it decides whether the cascade feed is worth keeping.
