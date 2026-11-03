# Landscape v1 -- what TradeKit should build next (living copy)

**Promoted:** 2026-11-03 (S54) from the frozen campaign folder `docs/collab/landscape-v1/` (ship-ready after Round
4b). Evidence, provenance tags and the dispute log live there: `MERGED_CANDIDATES.md` is the full merge,
`REVIEW_A.md` (desk research), `REVIEW_B.md` + `NOTES_FROM_B.md` (our own numbers), `REDTEAM.md` (non-voting),
`RUN.md` (gate log). **This file is the one to update**: change the Status column, add H's decisions, never edit the
campaign folder.

**Question answered:** where is an edge this project can capture with $100-$1k, a 15-minute clock and one ARM VPS,
and what should it build next?

## Verdict (2026-11-03)

No strategy candidate survived measurement. S6 is signal-dead (live PF 0.26 on 26 trades; PF 1.05 even at zero
fee). S1 is positive on BTC in both backtest windows (PF 1.30 / 1.22 with real Hyperliquid funding, 13 trades) but
the same unchanged rule fails on ETH, SOL and XRP (pooled test PF 0.79), so S1 is a zero-cost default, not an edge.
Costs, slippage, capacity and bankroll size are not levers below ~$50k notional. The one *sure* positive number is
yield on the ~98% of the balance the bot never uses. And nothing is actionable until the VPS can place orders again
(dead since 2026-10-18).

## Pre-condition

| id | item | status |
|---|---|---|
| P-1 | **VPS agent wallet unregistered on Hyperliquid since 2026-10-18 09:45Z** (`extraAgents` = `[]`; 16 signals + 4 manual commands failed). Needs H's MetaMask to approve a new agent, the VPS `.env`, a restart, `test_connection.ts` + one $20 `test_micro_trade.ts`. Bundle with the pending Supabase key rotation and the S1-only switch. | OPEN -- needs H |

## What we have

| strategy | verdict | status |
|---|---|---|
| S1 (4H EMA trend, BTC) | MONITOR -- default if the bot trades at all; no investment | live (when P-1 is fixed), `ENABLED_STRATEGIES=S1` |
| S6 (1H BBWP breakout) | KILL | to disable at the P-1 restart; keep `s6-diag` logging for the paper ledger |
| S5 cascade webhook | MONITOR -- 955/955 `medium`, `high` never seen; gate question open (Q2) | leave running |
| S2, S3, S7, S4 grid | CLOSED (known-dead, re-measured) | -- |

## Candidates

| id | candidate | disposition | flips if (kind) | status |
|---|---|---|---|---|
| C5 | Restore the exchange write path + a write-path probe that alerts on `does not exist` / `ApiRequestError` | **BUILD (blocking)** | H declares the VPS signal-only (P) | OPEN |
| C4 | Paper-execution ledger: every risk-gated signal → `paper_trades` row with the engine's fill/exit model; backfill 52 S6 + 7 S1 diag lines; fills-based P&L reconciliation | **BUILD** (4-6 h, no exchange risk) | H never runs anything unfunded (P) | OPEN |
| C6 | Lend the idle USDC (Hyperliquid Earn ~3.5-4.8%) -- yield, not edge; ~$4/yr at $103, ~$36/yr at $1k | **EVALUATE** (docs look-up, 0.5 session) | lent USDC cannot back margin → MONITOR (L); H declines lending risk → CLOSED (P) | OPEN -- needs D4 |
| C1 | S1-only live | MONITOR | 20 live S1 at PF < 1.0 → stop (M); paper S1 ≥ 60 at PF > 1.3 → size up (M) | default |
| C7 | Cascade graded on our side | MONITOR | first `high`; or ≥ 30 independent episodes with ≥ 3 leading a ≥ 3% drop by ≥ 1h (M); Q2 answered (L) | waiting on Flash |
| C9 | S1 on HIP-3 non-crypto perps | MONITOR | a trend rule generalises (M) AND target market in growth mode (L) | -- |
| C10 | Regulated EU fallback venue (Kraken EEA / OKX EU) | MONITOR | Hyperliquid incident (L); H's legal position (P) | -- |
| C2 | Same S1 rule on an ETH/SOL/XRP basket | CLOSED (failed: pooled test PF 0.79) | pre-registered vol-scaled-stop replay passes A's pooled gate (M, Q3) | -- |
| C3 | Cut S6's fee drag (maker, staking, Lighter, tier) | CLOSED (S6 is noise at zero fee) | a strategy ≥ 1.2 at zero fee but < 1.1 at taker (M) | -- |
| C8 | S6 unchanged on XRP (1.10 / 1.18) | CLOSED | pre-registered S6 replay on DOGE/ADA/LINK: ≥ 2 of 9 alt × rule pairs at PF ≥ 1.2 both windows → paper only (M) | -- |
| C11 | Funding capture (DIY basis 5-6%/yr; cross-venue 19-day break-even) | CLOSED | portfolio margin < $10k AND funding well above floor (L); cross-venue spread > ~10% APR, both venues EU-usable (L) | -- |
| C12 | HLP, user vaults, copy trading (HLP trailing APR -0.1%) | CLOSED | HLP 90d APR > lending for a quarter (L) | -- |
| C13 | Funding/OI/flow extremes; listing events | CLOSED | published OOS result at 4h-1d with costs on 2024+ data (L); a post-listing fade that survives the listing delay (L) | -- |
| C14 | Bankroll top-up as a lever | CLOSED | a configuration with positive live expectancy (M) | -- |
| C15 | BTC grid, S2, S3, S7, S6+regime | CLOSED | new argument + numbers | -- |

## Checks and fixes (not candidates)

| id | item | action | status |
|---|---|---|---|
| Q1 | **Live bot reads a higher-TF bar one 15m slot early with a provisional close** (`candle-consumer.ts:219-236` pushes the just-opened bar before aggregating; `aggregator.ts:40` only drops short buckets) -- at xx:45 (1H), 03:45/07:45/… (4H), 23:45 (1D); `snap15m` is the just-opened bar | measure share of `s1-diag`/`s6-diag` rows at :45 slots; fix: aggregate `buffer.slice(0,-1)`, gate S1/S6 on the higher-TF timestamp changing. **Separate deploy, after C5's gate passes** | OPEN |
| Q2 | Flash's `high` gate never fires though its stated conditions (>10 imminent, >$50M debt) are met most hours | send the runbook Task C message to Flash | OPEN |
| Q3 | Does "S1 fails on alts" measure the rule or the fixed 3% stop? | optional pre-registered ATR-scaled-stop replay (futures archive); else leave C2 closed | needs D5 |
| Q4 | Naked-position windows when `setStopLoss` throws after a fill / `closePosition` throws after the stop is cancelled | reduce-only close first, cancel stop after; register the position before placing the stop | OPEN (known) |
| Q5 | Multi-asset seams (8 BTC-bound places, BTC-only kill switch, dead-man matches any feed) | only if C8's flip is met | -- |
| Q6 | Desktop master `0x3a8a…` traded $1.16M on 19 coins (Apr-Oct 2026) -- who/what? sub-accounts unlocked there | H answers (D7) | OPEN |
| Q7 | `trade_log.json` open records accumulate (reconcile never `logTradeClose`); hydration `find` picks the oldest match | count `exit_price: null` on the VPS; fix with the C5 restart if non-zero | OPEN |
| Q8 | Weekend 08:18-09:36Z 502s from the HL REST edge (10 episodes / 75 days, all recovered) | ask in HL Discord if it lengthens | -- |
| Q9 | Backtest hygiene: OOS scripts charge flat 10.95% APR funding (real HL: 7.44% test / 19.5% train); split dates are free CLI flags | commit split date + asset list before any sweep; add an HL-funding option | OPEN |
| Q10 | Discord alert failures are swallowed; S5 sender reads `✓` if it never connected | log on alert failure; flag `lastAt === 0` after 2 h | OPEN |

## Decisions for H

| # | decision | numbers | H's answer |
|---|---|---|---|
| D1 | Is the VPS meant to trade at all? | 0 of 20 orders since 10-18; nothing at risk meanwhile | **YES** (S55, 2026-11-03) — to keep the live pipeline exercised and watched, not as a return case. Blocked on Neo (controls `0x5642…`) approving a new agent. |
| D2 | Strategy set after P-1 | S6 -$27.47 live, PF 1.05 at zero fee; S1 +$12.62 OOS on 13 trades, fails on alts | **S1 only** (S55, 2026-11-03) — `ENABLED_STRATEGIES=S1` at the row-2 restart; S6 killed. |
| D3 | Top-up? | size changes only the magnitude of -$1.08/trade | |
| D4 | Protocol-lending risk on idle USDC (C6)? | ~98.5% idle; ~$4/yr at $103 | |
| D5 | Spend 1-2 h on Q3 and/or C8's flip test? | pre-registered backtests, no money | |
| D6 | Ask Flash about the `high` gate (Q2)? | 27 + ~500 heartbeats met the stated conditions, 0 `high` | |
| D7 | The desktop account's $1.16M / 19 coins (Q6) | above the $100k sub-account unlock | |
| D8 | Second venue? | no return case; venue-risk case only | |
| D9 | Residency / legality / tax | ESMA 2026-02-24 binds EU firms; national law unconfirmed | |
| D10 | Is activity itself a goal? | S1 ≈ 9 trades/yr; S6 supplied activity and paid for it | |

## Recommendation (ranked)

1. Decide D1, then fix the pipeline in one restart (agent wallet + Supabase key + S1-only), verify one live entry
   with its stop, and only then deploy the Q1 fix and the write-path probe as a separate change.
2. Build the paper ledger (C4) and judge every future idea on it.
3. Do not fund a new strategy this quarter. The cheap "yes" items: C6 look-up, the Q2 message to Flash, and the two
   pre-registered backtests (Q3, C8's flip) if D5 is yes.
