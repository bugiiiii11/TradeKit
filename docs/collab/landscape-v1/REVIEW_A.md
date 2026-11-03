# REVIEW_A -- desk research (Seat A), landscape v1, Round 1

**Seat:** A (desk research). **Written:** 2026-11-03. **Every URL accessed 2026-11-03** unless stated.
**Tags:** ⚠>90d = source dated before 2026-08-05 (date given). UNDATED = page shows no date (most
Hyperliquid GitBook pages are undated live docs). `[verify: B]` = measurable by Seat B. `[verify: H]` = owner only.
**Repo files read:** CLAUDE.md, BTC_TRADING_STRATEGY_KB.md, docs/polish/s52-corrected-matrix.md,
docs/tradekit-strategy-ideas-from-flash.md, docs/s4-grid-backtest-analysis.md, docs/grid-trading-lessons-flash.md,
src/strategy/{s1,s5,s6,types}.ts, and grep-level skims of src/backtest/engine.ts, collector.ts, binance-loader.ts and the
two download scripts. I did **not** read RUN.md: the brief forbids opening any other file in docs/collab/. Section 8
therefore states the reach I *assume* B has. Correct it against RUN.md at merge.
**Method:** four parallel web sub-researchers (Hyperliquid, funding, venues, signals/studies). I then re-fetched the
load-bearing numbers myself: the Hyperliquid fee, funding, sub-account, portfolio-margin and vault-leader docs; the
Lighter fee page; the Binance-hack article; the "Who loses" paper, whose text I extracted.

---

## 1. Verdict

**No.** Public sources show no edge this project can capture at $100–$1k that clearly beats keeping S1. Even a
real edge is worth single-digit to low-double-digit dollars a year at this size.

**The baseline.** S1's corrected test-window result is +$12.62 on $500 over 444 days, about **2.1%/yr on bankroll**:
roughly **$2/yr at $103, about $21/yr at $1k**. That is *below* the 3.5–4.8% the idle 85–95% of the same bankroll could
earn in USDC lending on Hyperliquid itself (DefiLlama yields, see A4).

**What the population evidence says.** A wallet-level study of Hyperliquid's top-10 contracts, 2025-03-27 to
2026-06-30, found that **algorithmic takers, our category, "approximately break even" after fees**. Market makers took
+$208M and front-end (retail) traders lost $1.11B, $725M of it in fees.
Source: Jia, Moallemi, Wang & Zeng, AFT 2026 extended abstract,
https://drops.dagstuhl.de/storage/00lipics/lipics-vol395-aft2026/LIPIcs.AFT.2026.36/LIPIcs.AFT.2026.36.pdf

**Where an edge most plausibly sits, if anywhere.** Both candidates are EVALUATE, and I have no BUILD row.
- **A2: the *same unmodified* S1 rule on a basket of liquid coins instead of BTC alone.** The dated evidence favours
  10–15 coins over a single asset (Man AHL 2024-12-19 ⚠, Zarattini et al. 2025-05 ⚠). One peer-reviewed study found
  BTC's out-of-sample technical predictability gone while alts' remained (Hudson & Urquhart 2021 ⚠). The basket would
  also fix S1's real problem, which is 13 test trades.
- **A3: removing S6's fee drag.** By my estimate S6 paid roughly $36 in taker fees to net +$3.27, so it may be
  fee-killed rather than signal-dead.

**Closed or yield-only.** Funding capture is yield (~5–8% on hedged notional, the same as a yield token). Vault and
copy following is a manager bet. Cascade, OI, funding and exchange-flow signals have no published out-of-sample
support at our horizon. Listing events are too fast for a 15m clock.

**Two corrections to the prior:**
1. **The backtest models Binance funding.** Hyperliquid BTC funding ran 2.3–3.7 points/yr *higher* in both windows I
   could match. Longs on Hyperliquid pay more than the matrix assumes; at 10x/5% that difference is the same order as
   S1's whole edge.
2. **The matrix's line "S1 is the only configuration positive in both windows" contradicts its own table.** S6 alone
   (+$74.19 / +$3.27) and S1+S6 (+$79.64 / +$8.88) are also positive in both windows, just thinly. The defensible claim
   is "S1 is the only one positive in both with PF > 1.1".

**flips if:**
- **(a)** B's alt-basket rerun (A2) shows S1 PF ≥ 1.2 in both windows on at least 2 of ETH/SOL/XRP, with pooled test
  n ≥ 40. *Measurement for B.* Flips toward "edge = trend across a basket".
- **(b)** B's fee-swap rerun (A3) shows S6 PF ≥ 1.15 in both windows at maker-level fees. *Measurement for B.*
- **(c)** B's funding correction turns S1's test window negative. *Measurement for B.* Flips toward "not even S1".
- **(d)** H rules out putting idle bankroll into a lending product, or the docs look-up shows lent USDC cannot back
  margin. *Preference for H, plus a look-up.* Removes the only sure positive number on the page.

---

## 2. Candidate table

Caps: 12 rows; BUILD 0/3, EVALUATE 3/4. "Notional" means 5% margin × leverage: S1 at $103 is about $51.

| id | candidate | kind | what it needs that we lack | size it could carry | expected edge (source, date) | disposition | flips if: |
|---|---|---|---|---|---|---|---|
| A1 | **Incumbent: S1 (+S6 pending A3) on Hyperliquid, unchanged** | strategy | nothing | any size up to well past $1k; BTC book carries $500k orders at ~0.1 bp ([1]) | test +$12.62/444d on $500 ≈ 2.1%/yr, PF 1.30, n=13 (s52 matrix, 2026-09); before the funding correction (§8 #2) | MONITOR | B's funding correction or live-fill audit makes S1 negative → nothing to keep; or A2 passes → S1 becomes one leg of a basket |
| A2 | **S1 unchanged on a basket (BTC + ETH, SOL, XRP; HYPE once history allows)** | strategy | symbol parameter in `download_binance.ts`, `download_funding.ts` and the `binance-loader.ts` filename filter (BTCUSDT hard-coded); per-coin S1 state (`prev4H` is a module singleton in `s1_ema_trend.ts`); live multi-coin WS in `candle-consumer.ts` | $100 → about $51 notional per coin, above the $10 minimum; Hyperliquid 24h volume ETH $920M, SOL $268M, XRP $58.7M ([2]) | Sharpe after costs peaks at about 10–15 coins (Man AHL, 2024-12-19 ⚠); top-20 Donchian ensemble Sharpe > 1.5 net, 2015–2025-03 (Zarattini et al., SSRN 5209907, rev. 2025-10-02 ⚠); BTC out-of-sample predictability gone, alts' kept (Hudson & Urquhart 2021 ⚠). No study covers 2025–26 out-of-sample, and a 2026-02 Bloomberg piece ⚠ says 2025 was a bad year for crypto trend funds | **EVALUATE** | fails the §4 gate → trend edge not demonstrable on majors in 2025–26 → S1-BTC likely noise too |
| A3 | **Cut S6's fee drag: maker entries on Hyperliquid, or a 0-fee venue (Lighter Standard: 0/0)** | strategy + venue | fee-sensitivity rerun (one engine constant, `TAKER_FEE` line 42); maker entries need a fill model the engine lacks; Lighter needs a new client (TS state client plus WASM signer), a new wallet and new ops | Lighter BTC 24h volume $1.19B (live API via sub-researcher); $10 minimum | Hyperliquid maker 0.015% vs taker 0.045% ([3]); Lighter Standard "no maker or taker fees", 300 ms taker delay ([4]); my estimate of S6 test fees ≈ 198 × $200 × 0.09% ≈ **$36 vs +$3.27 net** `[verify: B]` | **EVALUATE** | at fee 0, S6 test PF < 1.10 → S6 is noise, not fee-killed → drop S6, keep S1 alone |
| A4 | **Idle-bankroll yield: lend the 85–95% of USDC the bot never uses (Hyperliquid Earn/lending)** | passive | look-up: does supplied USDC count as perp margin, and can the bot redeem it? (The agent wallet is trade-only, so redemption probably needs the master wallet.) | the whole idle balance; lending TVL $142M (DefiLlama) | Hyperliquid Earn USDC 3.46% now, 30d mean 4.79% (DefiLlama yields, via sub-researcher, 2026-11-03); vs sUSDe 90d mean 4.76%. **This is yield, not an edge.** At $1k × 90% × ~4% ≈ $36/yr, more than S1's expected ~$21 | **EVALUATE** | lent USDC can't back margin and needs manual moves each trade, or H declines protocol-lending risk |
| A5 | **S5 cascade overlay: grade the Flash heartbeat** | strategy (event) | nothing new to build; needs grading of the numbers logged since 2026-09-24 | $51–$500 short | no study shows lending liquidations *lead* BTC (Bank of Canada on Aave: price leads liquidations; date not fetched). Across 7 Binance cascades 2022–25, "no tested price, leverage, or order-flow metric warned consistently" (Garcia Seuma, arXiv 2607.27070, 2026-07-29 ⚠). 87.8% of forced selling after onset falls within 30 min, i.e. 1–2 of our bars (arXiv 2608.03616 via CryptoSlate, 2026-08-18) | MONITOR | B's grading shows heartbeat spikes leading ≥ 3% BTC drops by ≥ 1h on ≥ 3 events |
| A6 | **S1 on HIP-3 non-crypto perps (gold, oil, SP500)** | strategy + market | per-market data (HIP-3 history is short; would need external futures history), symbol plumbing as in A2, and handling of deployer halt and weekend-oracle rules | CL 24h volume $441M, GOLD OI $316M, SP500 volume $296M (hyperliquidguide.com/markets/hip-3, third-party, 2026-11-03) | fees reportedly 0.09%/0.03%, 2× native, unless the market is in growth mode (third-party, 2026-11-03). Weekend oracle anchors to Friday's close and positions can be liquidated on weekends (Blockworks, 2025-10-20 ⚠). Deployer can halt and settle at mark (HIP-3 docs, UNDATED). No edge number found | MONITOR | A2 passes (the engine generalises) **and** a target market is confirmed in growth mode (0.0045–0.009% taker) |
| A7 | **Regulated EU fallback venue (Kraken EEA or OKX Europe X-Perps)** | venue | new client; KYC; appropriateness test | 0.0001 BTC minimum (both, live API) | no edge: 5 bp taker / 2 bp maker on both (kraken.com/pro/fees, UNDATED; okx.com/en-eu/help/okx-x-perps-eea-fees-overview, 2026-09-01), worse than Hyperliquid's 4.5/1.5. The value is venue diversification. ESMA's statement (2026-02-24 ⚠) puts EU-firm perps for retail inside the CFD measures, which risks a 2:1 retail cap | MONITOR | Hyperliquid has a solvency or withdrawal incident, or H's legal position on offshore DEXes `[verify: H]` requires it |
| A8 | DIY delta-neutral spot/perp basis on Hyperliquid (BTC or HYPE) | strategy (carry) | a spot leg (engine has none), two-leg execution, liquidation management | $500 → $333–375 hedged | net about **5.0–6.0% APR on $500 (BTC), 8.1–8.3% (HYPE)** after taker fees; BTC gross capped near ~11% by the interest floor; HYPE rallied +70% in a week in Jan 2026, which would liquidate the short at 2–3x (sub-researcher computation from HexaTape, Binance klines and hyperliquidguide, 2026-08-25 to 11-03). Portfolio margin needs account value > $10k ([5]) | CLOSED | Hyperliquid opens portfolio margin to small accounts **and** BTC funding sustains well above the floor |
| A9 | Cross-venue funding arbitrage (Hyperliquid vs Binance and others) | strategy (carry) | capital pre-positioned on 2 venues; Binance closed to EEA | n/a | BTC HL−Binance spread +3.68% APR mean over 30d; **no 7-day window covered round-trip fees (~0.19%)**; break-even about 19 days; strictly worse than A8 (computed from fapi.binance.com and HexaTape, 2026-10-04 to 11-03) | CLOSED | a sustained spread > ~10% APR on a liquid coin, with both venues usable from the EU |
| A10 | HLP, user vaults, copy trading | passive | nothing | any | HLP TVL $150.4M, trailing APR −0.1% (vaultvision.tech/vaults, 2026-11-03); about 3.5% mid-October (EarnPark, 2026-10-19); TVL peak $603.9M (CoinGecko, 2026-07-02 ⚠). HLP returns cluster in crash events (+$41.5M on 2025-10-10). User vaults are "legacy" on HyperCore. 3,063 open vaults and no survivorship-adjusted statistics (hypebasis.io/vaults, 2026-11-03). **This is a manager bet, not an edge** | CLOSED | HLP 90-day APR rises above the lending rate (A4) for a full quarter |
| A11 | Funding, OI or exchange-flow extremes as entry signals | strategy (signal) | data feeds (CryptoQuant hourly from $29/mo; CoinGlass API from $29/mo, no free tier) | n/a | **no dated out-of-sample study of BTC returns at 1h–1d** found. Funding is forecastable, but that is funding, not price (Inan, SSRN 5576424). Net USDT inflows predict BTC in-sample, 2017–23 (arXiv 2411.06327 ⚠). Our own S7 test: −$3 over 26 months | CLOSED | a published out-of-sample result at 4h–1d with costs, on 2024+ data |
| A12 | Listing events (Binance, Upbit, Hyperliquid listings) | strategy (event) | an announcement scraper with a sub-minute clock | n/a | Upbit median first-day gain fell from 42% to 10% after mid-June 2026 (4pillars, 2026-08-12). Buying every 2025 Upbit listing at day-1 close returned −69.5% (Blockmedia, UNDATED). Upbit notice can be about 90 min (The TIE, 2026-07-13 ⚠). A 15m clock arrives after the pop | CLOSED | a sustained post-listing *fade* (short) with an out-of-sample test that survives Hyperliquid's listing delay |

Sources for table references:
- [1] TokenInsight-based ranking, 2026-08-16 to 09-14, relayed from a search summary of
  https://www.mexc.com/crypto-pulse/article/most-liquid-crypto-exchanges-in-2026-179429 (the page returned 404, so
  **unverified**).
- [2] https://www.coingecko.com/en/exchanges/hyperliquid, live snapshot with no timestamp.
- [3] https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees (UNDATED; re-fetched by me).
- [4] https://docs.lighter.xyz/trading/trading-fees (UNDATED; re-fetched by me).
- [5] https://hyperliquid.gitbook.io/hyperliquid-docs/trading/portfolio-margin (UNDATED; re-fetched by me).

---

## 3. BUILD rows expanded

**None.** Nothing clears the bar to build before a measurement. Each building candidate (A2's multi-coin live path, A3's
maker entries or Lighter client) is worth doing only if its EVALUATE gate passes first. Both first steps are cheap
backtest reruns. Building first would repeat the pattern the S52 matrix just unwound, where a decision outran its
numbers.

---

## 4. EVALUATE rows expanded

### A2 -- the same S1 rule on ETH, SOL and XRP (and HYPE if the history suffices)

**First step**
- Add a `--symbol` parameter to `download_binance.ts`, `download_funding.ts` and the `binance-loader.ts` filename filter
  (all hard-code `BTCUSDT`).
- Download 55 months for ETHUSDT, SOLUSDT and XRPUSDT.
- Run `backtest_oos.ts` per coin with S1 **exactly as is**: same EMAs, Daily-EMA200 filter, 3% stop and 10x. No tuning
  per coin; tuning would turn this into a fitted filter, the same signature as the rejected S6 regime filter.
- Report per coin and pooled.
- XRP is included because it has deep Binance history and $58.7M/24h on Hyperliquid (CoinGecko snapshot). HYPE is
  probably too short-lived on Binance for the 55-month warmup `[verify: B]`.

**Pass/fail gate**

| Outcome | Condition |
|---|---|
| **Pass** | S1 PF ≥ 1.2 in **both** windows on at least 2 of the 3 alts, **and** the pooled basket (BTC + passing alts) has test-window PF ≥ 1.2 with n ≥ 40, max DD ≤ 15% |
| **Fail** | pooled test PF < 1.1, or fewer than 2 alts pass |

**Cost:** about 1 session for B, or for whoever owns the backtest lane. It is mostly download time plus a
three-file symbol parameter.
- If it passes, the live build is **M–L**: per-coin S1 state (`prev4H` is a module singleton), multi-coin WS in
  `candle-consumer.ts`, and a per-coin risk manager. The current cap is 3 positions and 60% exposure, which bounds a
  basket at 3 coins concurrent. This is a later decision.

**What we learn if it fails:** the trend edge does not show on majors in 2025–26 either. S1-on-BTC's PF 1.30 on 13
trades is then most likely noise. Strategy development stops having an obvious next step, and the honest framing
becomes "the bot is a learning platform, and the money question is answered by A4".

### A3 -- is S6 fee-killed or signal-dead?

**First step:** rerun `backtest_oos.ts` for S6-only and S1+S6 at three values of the engine's `TAKER_FEE`
(`src/backtest/engine.ts:42`), and report the fee total per strategy:
- 0.00045 (current Hyperliquid taker)
- 0.00015 (Hyperliquid maker on both legs, an optimistic bound)
- 0 (Lighter Standard)

**Pass/fail gate**

| Outcome | Condition |
|---|---|
| **Pass, Hyperliquid maker entries** | S6 PF ≥ 1.15 in both windows at 0.00015 → scope maker-entry S6 on Hyperliquid. Needs a fill model, since breakout entries placed as resting limits fill mainly on the losers. That build is M |
| **Pass, Lighter only** | passes only at 0 → Lighter becomes a candidate, gated by H's appetite for a second venue (§7). It is L2BEAT Stage 0 and had a 4.5h outage on 2025-10-10 (ambcrypto, 2025-10-12 ⚠) |
| **Fail** | S6 test PF < 1.10 at fee 0 |

**Cost:** about 0.5 session. Changing a constant on a scratch branch is enough; nothing needs merging.

**What we learn if it fails:** S6's fees are not what kills it, so S6 is noise. Dropping S6 then needs no further
argument, and S1 runs alone with half the drawdown (matrix: 5.9% vs 11.7%).

### A4 -- put the idle bankroll to work (yield, not edge)

**First step:** a docs look-up, no code. Establish four things:
1. Hyperliquid's USDC lending ("Earn") mechanics: whether supplied USDC counts toward perp account value or isolated
   margin under the Unified Account.
2. Redemption latency.
3. Whether a trade-only agent wallet can supply or redeem. I expect not, which means owner-signed moves.
4. Rate history and any loss events. The 3.46% current / 4.79% 30d figure is relayed from DefiLlama by a
   sub-researcher; I did not open the pool page.

**Pass/fail gate**

| Outcome | Condition |
|---|---|
| **Pass** | 90-day mean ≥ 3%, **and** either supplied USDC backs margin directly, or the owner is happy to move funds by hand on top-ups only (the bot's 5% margin per trade fits in a fixed unlent float) |
| **Fail** | redemption is slow, or there is a loss event in the lending pool's history |

**Cost:** about 0.5 session, plus an owner decision (§7).

**What we learn if it fails:** nothing about edges. We do keep the hurdle rate. Any future strategy has to beat roughly
4% on the capital it ties up, and S1's ~2.1%/yr on bankroll doesn't.

---

## 5. Hyperliquid at our size

| Item | Value | Source (accessed 2026-11-03) |
|---|---|---|
| Perps fee, tier 0 | 0.045% taker / 0.015% maker | hyperliquid-docs/trading/fees (UNDATED, re-fetched) |
| Tier 1 threshold | > $5M 14-day weighted volume → 0.040% / 0.012% | same |
| Tier 1 at our size | about 5,000 round trips of $500 in 14 days (my arithmetic). Unreachable | — |
| Spot fee, tier 0 | 0.070% / 0.040%; spot volume counts double toward tiers | fees page (UNDATED) |
| Maker rebates | −0.001% / −0.002% / −0.003% at > 0.5% / 1.5% / 3.0% of *all* 14d maker volume | fees page (re-fetched) |
| HYPE staking discount | Wood > 10 HYPE −5%; Bronze > 100 −10%; Silver > 1k −15%; Gold > 10k −20%; Platinum > 100k −30%; Diamond > 500k −40% | fees page (re-fetched) |
| Cost of Wood | 10 × $83.64 ≈ **$835**, saves about $0.02 per $500 round trip | coingecko.com/en/coins/hyperliquid (snapshot, undated) |
| Referral discount | 4% off fees on the first $25M volume; not on sub-accounts | hyperliquid-docs/referrals and /trading/sub-accounts (UNDATED) |
| Points / airdrop | no active programme listed (two phases, 2023-11 to 2024-11) | hyperliquid-docs/points (UNDATED) |
| Builder codes | max 0.1% perps / 1% spot, paid on *other* users' flow (routing our own orders through our own code is circular) | hyperliquid-docs/trading/builder-codes (UNDATED) |
| Minimum order | $10 notional (reduce-only exempt per Chainstack) | hyperliquid-docs/.../error-responses (UNDATED); docs.chainstack.com (UNDATED) |
| Max leverage | BTC 40x, ETH 25x, SOL 20x, HYPE 10x; integer only | hyperliquid-docs/trading/margin-tiers, /margining (UNDATED) |
| Funding | paid hourly; interest component "0.01% every 8 hours" (≈ 10.95% APR to shorts when premium ≈ 0); cap 0.5%/hour | hyperliquid-docs/trading/funding (UNDATED, re-fetched) |
| BTC funding, observed | 30d Oct 4–Nov 3: 8.9–8.94% APR, 70.8% of hours exactly at the floor, max print = floor. 90d May 27–Aug 25: 7.67% | hexatape.com/history/hyperliquid; usekeel.io/lab/funding-leaderboard; hyperliquidguide.com (2026-08-25) |
| Binance BTC funding, same use | 90d to Nov 3: 5.95% APR; 180d: 5.23% | computed from fapi.binance.com/fapi/v1/fundingRate (2026-11-03) |
| Sub-accounts | "Up to 10 sub-accounts can be created after reaching $100,000 in volume"; +1 per $100M, max 80; API wallets: 3 + 2 per sub-account | hyperliquid-docs/trading/sub-accounts (UNDATED, re-fetched) |
| Agent wallet on sub-accounts | "approve API wallets to sign on behalf of the master account or any of the sub-accounts" | hyperliquid-docs/.../nonces-and-api-wallets (UNDATED) |
| Portfolio margin (spot as collateral) | needs "> $5M in weighted volume or account value > $10k". **Closed to us** | hyperliquid-docs/trading/portfolio-margin (UNDATED, re-fetched) |
| HLP | TVL $150.4M; trailing APR −0.1%; 4-day lock-up after last deposit; no fee | vaultvision.tech/vaults (2026-11-03); hyperliquid-docs/hypercore/vaults/protocol-vaults (UNDATED) |
| HLP history | about 3.5% APR mid-Oct 2026; about 7% for the month to Aug 2026; TVL peak $603.9M (Sep 2025); all-time PnL +$138.6M | earnpark.com (2026-10-19); datawallet.com (2026-08-26); coingecko.com/learn/hyperliquid-hlp-vault-analysis (2026-07-02 ⚠); hypebasis.io/vaults |
| HLP worst events | −$4M (2025-03-12 ETH whale ⚠); −$4.9M (2025-11-12 POPCAT ⚠); −$1.5M (2026-04-09 FARTCOIN ⚠); −$556K (2026-11-01 XPL) | coindesk.com 2025-11-13 ⚠; tokenpost.com/news/investing/45783 (2026-11-01); datawallet |
| User vaults (legacy) | depositor lock 1 day; leader 10% profit share, ≥ 5% ownership, "10k USDC gas fee" to create | hyperliquid-docs/.../for-vault-leaders-legacy (UNDATED, re-fetched) |
| BTC liquidity | 1 tick ≈ $1 ≈ 0.13 bp; about $15.4M within 0.03% of mid (unverified relay); 24h volume $2.65B, OI $3.08B | tick-size docs (UNDATED); [1]; coingecko snapshot |

**Implication for our sizes.** Execution cost at $50–$500 is the fee: about $0.02–$0.23 per side. Spread is under $0.01.
The only Hyperliquid structure that changes our economics is **funding**: longs pay a floor of about 11% APR most of
the time.

---

## 6. Where the flow went

**Short-horizon technical edges on BTC are compressed, not captured.**
- BTC's average daily realised volatility fell every year: 4.13% (2021), 3.34% (2022), 2.94% (2023), 2.80% (2024),
  **2.24% (2025)**. August 2026 30-day volatility was 1.13%/day, below the Nasdaq's 1.5% (K33 data via
  spark.money/research, 2026-09-08). Trend rules make money on large moves, and there have been fewer of them.
- Over 2011–2026 halving epochs, short-horizon indicators "decay toward zero, and several invert sign" (Molnar, arXiv
  2607.26188, 2026-07-28 ⚠, search snippet).
- Hudson & Urquhart (2021 ⚠) found no out-of-sample BTC predictability where alts kept some.
- No single counterparty took this flow; it shrank with volatility. A $1k participant can't "join" it. The only lever
  is more independent bets (A2).

**Intraday flow goes to market makers, paid by retail fees.**
- Jia et al. (AFT 2026, sample to 2026-06-30): market makers +$208M, algorithmic takers about break-even, front-end
  traders −$1.11B.
- Front-end fees were 2.99 bp of volume; market makers paid 0.16 bp and algorithmic takers 2.17 bp.
- Front-end traders "open in the direction of recent returns", which is trend-chasing, while the other groups open
  against them.
- Joining the maker side requires sub-second quoting and a share of maker volume (≥ 0.5% of the whole venue for the
  first rebate). **CLOSED for us.**

**Liquidation-cascade flow goes to HLP and the liquidator backstop.**
- In the worst minute of 2025-10-10, about $576M of $641M of forced sales went to the HLP backstop, not the public book
  (arXiv 2608.03616 via CryptoSlate, 2026-08-18). HLP gained about $41.5M that day (CoinGecko, 2026-07-02 ⚠).
- A $1k participant *can* join this channel, as an HLP depositor. But its payoff is crash-concentrated, and its trailing
  return is about 0% today with TVL down about 75% from peak (§5). That is yield on a rare event, not an edge, and today
  it pays less than lending.
- Flash's cascade signal (S5) points at the same events. The sources say the move is mostly over within 30 minutes of
  onset.

**Funding carry went to basis funds and compressed.**
- sUSDe yield: 37.7% (Mar 2024 ⚠) → 4.76% 90d mean now (DefiLlama pool, via sub-researcher).
- Ethena's own backing is now about 1% exchange basis at −0.1% APY (LlamaRisk June 2026 update, posted 2026-07-17 ⚠,
  gov.ethenafoundation.com/t/808).
- CME 3-month basis was about 2.08% in Aug 2026 (thecoinrepublic.com, 2026-08-10).
- A $1k participant can join by holding a token or doing the trade DIY (A8). Either way it is about 5% yield.

**Listing pops went to announcement-scraping bots, and are fading.** Upbit's median first-day gain fell from 42% to 10%
(4pillars, 2026-08-12). A 15m clock is structurally late. CLOSED.

---

## 7. Decisions for H

1. **Capital top-up.** Recommend **no top-up unless A2 passes.** Under the base case, $1k makes S1 worth about $21/yr
   before funding correction. Topping up to make A4 meaningful is a separate yield decision, not a trading one.
2. **Time budget.** The full EVALUATE set is about 2 sessions: A2 ~1, A3 ~0.5, A4 ~0.5. Is that worth spending, given
   the likely result is "keep S1 and lend the rest"?
3. **"See something happen" vs S1's ~9 trades/yr.** S6 supplies activity but, on my estimate, mostly pays fees. A2 would
   raise cadence honestly, with more coins and the same rule. Is activity itself a goal?
4. **Appetite for a second venue.**
   - Lighter is only relevant if A3 passes at fee 0. It is Stage 0, with a 4.5h outage on 2025-10-10 ⚠ and verifier
     halts in Oct 2026 (techflowpost, 2026-11-02).
   - The regulated EU fallbacks (A7) need KYC.
   - Context: Drift was hacked 2026-04-01 ⚠, and Binance lost $6.3B on 2026-10-29 (TechCrunch, 2026-11-01, re-fetched;
     Binance says users are covered).
5. **Residency, legality, tax `[verify: H]`.**
   - ESMA's statement (2026-02-24 ⚠, ESMA35-243228190-8024) binds EU *firms*. No regulator source found says an EU
     individual offends by using an offshore DEX; the one secondary source on Germany says not (cryptoticker.io,
     2026-09-15). This is national law and unconfirmed for H's country.
   - Tax treatment of funding received or paid is also H's.
6. **Protocol-lending risk for idle USDC (A4).** Acceptable at all? If so, at what share of bankroll?
7. **S6 now.** Wait for A3, or drop S6 today on the matrix's risk-adjusted numbers?

---

## 8. `[verify: B]` list

*Reach assumed, since I could not read RUN.md: B can run local backtests from the repo, query our Hyperliquid
accounts' fills and funding via the info API, and read our trade logs. Correct this against RUN.md.*

1. **Fee totals in the corrected out-of-sample run.** Sum fees paid per configuration (S1, S6, S1+S6), test and train.
   Then rerun at `TAKER_FEE` = 0.00015 and 0. This is A3's first step, and it checks my $36 estimate (computed at fixed
   $200 notional, without compounding). Reach: local backtest.
2. **Funding correction for S1 and S6.** Either rerun the corrected out-of-sample run with Hyperliquid funding instead
   of Binance's (if B's reach includes `fundingHistory`), or at minimum report S1's time-in-market split long vs short
   and the funding the backtest charged.
   - Hyperliquid BTC funding exceeded Binance by +2.3 points (May 27–Aug 25) and +3.7 points (Oct 4–Nov 3).
   - At S1's 50%-of-bankroll notional, that is about 1.2–1.9%/yr of bankroll *while long*, against an edge of about
     2.1%/yr.
   - Reach: local backtest plus Hyperliquid info API.
3. **Live execution vs model.** For every live S1/S6 entry and exit, measure fill price vs bar close (entries) and vs
   stop trigger (stop exits). The engine assumes `SLIPPAGE_BPS = 0`. Reach: Hyperliquid fills plus trade log.
4. **Live funding paid per trade and per strategy since go-live**, compared with what the backtest would have charged
   on the same holds. Reach: Hyperliquid info API (`userFunding`).
5. **Lifetime traded volume** of the VPS account and the desktop account. Sub-accounts unlock at $100k. Reach:
   Hyperliquid info API.
6. **Time-weighted share of bankroll actually used as margin** (expect under 15%). This sizes A4. Reach: trade log.
7. **S5 heartbeat grading.** Since 2026-09-24, correlate `severity`, `aggregate_debt_usd`, `imminent` and
   `estimated_impact_usd` with BTC forward returns at 1h, 4h and 8h. Count `medium` events and the largest values seen.
   This is A5's flip test. Reach: webhook logs in Supabase `bot_logs` (source `webhook`).
8. **A2 data availability.** Does `data.binance.vision` still serve ETHUSDT, SOLUSDT and XRPUSDT 15m klines and USDⓈ-M
   funding for 55 months, after Binance's EEA exit (2026-07-01 ⚠)? How many months of HYPEUSDT exist? Reach: download
   script.
9. **Referral discount.** Do our accounts have a referral code applied (4% off the first $25M)? Reach: Hyperliquid
   info API, `referral`.
10. **Matrix wording.** Confirm from the `backtest_oos.ts` output that S6-only and S1+S6 are positive in both windows,
    so the merge can fix "S1 is the only configuration positive in both windows". Reach: local backtest.

---

## 9. Sharpest caveat about my own read

**Desk research cannot see our own costs, and at this edge size costs are the whole story.**
- Every edge number above is either someone else's backtest or our corrected backtest. The corrected backtest still
  assumes zero slippage, Binance funding and fills at bar close.
- At PF 1.30 on 13 trades, one bad stop fill or two weeks of Hyperliquid funding is the same size as S1's whole annual
  edge. Items 2–4 in §8 could move the verdict more than anything I found on the web.

**The evidence base is thinner than its citations look.**
- No rigorous trend study has an out-of-sample window covering 2025–26. The evidence for 2025 being bad for trend is a
  Bloomberg piece (2026-02-27 ⚠, read via snippet) and a vendor's −10% self-report (UNDATED).
- Several figures are relayed from search summaries of pages that returned 403 or 404, and are marked as such:
  TokenInsight depth, MDPI arb study, Molnar, Bloomberg.
- The Hyperliquid funding windows are two disjoint samples (May 27–Aug 25 and Oct 4–Nov 3). I could not get a clean
  Aug 5–Nov 3 Hyperliquid series without calling the API, which the brief forbids.
- Third-party trackers (vaultvision, hypebasis, CoinGecko snapshots) carry no timestamps or have inconsistent ones.

**I lean toward "no".** That fits the evidence, but it is also the safe answer. The red team should press A2 hardest:
it is the one place the literature points *toward* an edge, and I gated it rather than argued for it.

---

## 10. Looked and closed

- **S3, S2, S7:** stay dead; no new argument (matrix: PF 0.48 on 839 trades; S2 inverts; S7 −$3/26mo).
- **Any grid variant on BTC perps:** S4 root cause (recenters on a trending, funding-paying instrument) is unchanged.
  No new argument found.
- **Hyperliquid fee tier 1:** needs > $5M in 14 days, about 5,000 round trips at $500.
- **HYPE staking discount:** Wood is about $835 of HYPE to save about $0.02 per round trip.
- **Maker rebates:** need ≥ 0.5% of all Hyperliquid maker volume.
- **Builder codes:** pay only on other users' flow.
- **HIP-3 deployer:** 500k HYPE staked, about $42M.
- **Points / airdrop:** no active programme listed in the docs.
- **Portfolio margin (spot-as-collateral basis):** account value > $10k or $5M volume.
- **Sub-accounts as an edge:** an enabler only ($100k volume unlock); useful if A2 or A3 passes.
- **Hyperps (pre-launch perps):** 8h-EMA oracle, capped mark, funding at 1% of normal premium. Exotic, no edge number.
- **HIP-4 outcome markets:** a prediction-market product, not a fit for a trend engine.
- **Aster, edgeX:** 0.001 BTC minimum (about $77), above S1's $51 notional at $103.
- **Aster also:** withdrawals are operator-initiated (techflowpost, 2026-11-02).
- **Paradex:** retail 0/0 fees, but BTC 24h volume about $2.7M (live API via sub-researcher); Python-only SDK.
- **dYdX v4:** 5 bp / 1 bp; BTC 24h volume about $2M; 8h halt on 2025-10-10 ⚠.
- **Velocity (ex-Drift):** new deposits paused 2026-10-31; recovery tokens outstanding.
- **Binance:** EEA services stopped 2026-07-01 ⚠; $6.3B hack 2026-10-29.
- **Bybit EU:** spot and margin only; api.bybit.eu rejects linear BTCUSDT (curl via sub-researcher, 2026-11-03).
- **Bitget, Gate:** block several EU states, no EU perps.
- **BitMEX:** ceased operations 2026-09-23.
- **Vertex:** wound down 2025-07-14 ⚠.
- **Variational Omni:** zero fees, but no public trading API.
- **Deribit:** 3.5 / 1.5 bp, but no EU retail licence, ERC-20-only USDC with a 5 USDC withdrawal fee.
- **GMX v2:** 4–6 bp on open *and* close, plus price impact and borrow; about 8–12 bp round trip.
- **Orderly front-ends:** 3 bp base plus builder fee (Raydium 4.5 bp); no better than Hyperliquid.
- **Pacifica:** closed beta with a $500k equity cap; no SDK.
- **Extended:** 2.5 / 0 bp, but Python-only SDK and EU terms unverified. The nearest miss on this list; re-open only
  with A3.
- **Coinbase EEA futures:** fee split and API access for EEA futures unconfirmed.
- **sUSDe, Liminal, Neutrl, Falcon and other funding-yield tokens:**
  - Yields: sUSDe 4.76%, Liminal xBTC 7.82%, xHYPE 7.70%, all 90-day means (DefiLlama).
  - Risks: Resolv USR was exploited 2026-03-22 ⚠ (about $25M extracted, The Block).
  - Ethena itself is now mostly lending and T-bills.
  - If H wants yield, A4 is simpler and stays on the venue we already trust.
- **Liquidation heatmaps and "magnet" levels:** no out-of-sample test found. CEX maps are modelled estimates (CoinGlass
  learn page, UNDATED). Hyperliquid's native trade feed has no liquidation flag (WS docs, UNDATED).
- **DeFi lending liquidations as a leading indicator:** no study found that shows lead; one finds price leads.
