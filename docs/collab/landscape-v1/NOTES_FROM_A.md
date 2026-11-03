# NOTES_FROM_A -- Seat A's cross-review of REVIEW_B (Round 2)

Written 2026-11-03. Read: BRIEF_ROUND2.md, REVIEW_B.md. Not read: NOTES_FROM_B.md, REDTEAM.md. New web look-ups
are cited inline; every URL was accessed on 2026-11-03.

## 1. Items I dispute in B

| id | why |
|---|---|
| B6 gate (`REVIEW_B.md:100`) | "PF ≥ 1.2 on **both** ETH and SOL, n ≥ 10 each" is too small per asset to mean anything, and either asset failing kills the test. Prefer: PF ≥ 1.2 in both windows on ≥ 2 of ETH/SOL/XRP **and** a pooled test-window n ≥ 40 (my A2). |
| B6 data source | B plans `data/spot/...` klines, but the Binance USDⓈ-M futures archive exists and fits better (§4, tag 2). |
| B6 flips-if (`:48`) | "Both PF < 1.0 → S1-BTC is a fluke" is looser than B's own pass gate. A PF of 1.0–1.2 should read as "unproven", not as rescued. |

Nothing else disputed. B's live numbers outrank my desk estimates wherever the two overlap.

## 2. Candidates B missed that I caught

| id | why it matters |
|---|---|
| A4 idle-bankroll yield | B measures time in position (28%) but not idle *capital*. About 95% of the USDC sits unused. Lending at about 3.5–4.8% beats S1's ~2.1%/yr on bankroll. |
| Funding model (my §8 #2) | The backtest charges Binance funding; Hyperliquid BTC funding ran +2.3 to +3.7 points/yr higher. B's live +$0.01 is S6-dominated and says nothing about S1's 10x longs. |
| A7 venue fallback | B covers no venue risk. Context: Drift was hacked 2026-04-01 and Binance lost $6.3B on 2026-10-29. |
| A6 HIP-3 trend; A8/A9 carry | B never touches carry. My numbers close it: net 5–6% on BTC, 19-day break-even cross-venue. |

## 3. Candidates B caught that I missed -- concede

| id | concession, and the disposition I would now give |
|---|---|
| B3 restore exchange write path | The VPS has been unable to trade since 2026-10-18 09:45 UTC, and every health signal said fine. Nothing else on either list matters until this is fixed. **BUILD**, blocking. |
| B4 paper ledger | A free forward test. It is also the right harness for A2's alts before any money goes on them. **BUILD**. |
| B1 S6 dead | Live: n=26, PF 0.26, fees only 7.8% of the gross loss. Extended out-of-sample test: PF 0.94 on 219 trades. My "fee-killed" hypothesis is wrong. **CLOSED/KILL**. |
| B2 crowd-out | Inside S1+S6, only 7 of S1's 13 test trades happen, because S6 holds the single position slot. That is a direct cost of S6 I didn't see. |
| B11 dashboard P&L | `trades.pnl_usd` is gross and mark-based, and overstates P&L by $3.41. **MONITOR**, fold into B4. |
| B10/B9 costs measured | Taker cost is 4.32 bps (referral already applied); slippage is +0.24 bps entry and +1.65 bps on stops. This answers my verify-B #3 and #9. |

## 4. Answers to B's `[verify: A]` tags

| tag | answer | confidence |
|---|---|---|
| 1 | **Yes, documented:** "Only the most recent 5000 candles are available" (hyperliquid-docs/for-developers/api/info-endpoint, UNDATED). **No candle archive:** the `hyperliquid-archive` S3 bucket holds `l2Book` and `asset_ctxs` only. Quote: "No other historical data sets are provided via S3 (e.g. candles…)", about monthly uploads (hyperliquid-docs/historical-data, UNDATED). The `hl-mainnet-node-data` bucket has `node_fills`/`node_trades`, so candles could be rebuilt from raw fills; my effort estimate is L. A third-party export exists: trade-export.hypedexer.com. Keep Binance for history. | high |
| 2 | **Use the futures archive.** `curl -I` on 2026-11-03 returned HTTP 200 for `data.binance.vision/data/futures/um/monthly/klines/{ETH,SOL,XRP,BTC}USDT/15m/` (checked months 2022-02 and/or 2026-09) and for `…/fundingRate/ETHUSDT/…2022-02`. HYPEUSDT returned 200 for 2025-06 and 404 for 2025-01, so HYPE has too little history for the 55-month warmup. A perp-on-perp proxy also matches the funding file. Note our BTC backtests use **spot** (`download_binance.ts:18`). The divergence between Hyperliquid perp and Binance perp bars is unmeasured. | medium |
| 3 | **4.32 bps is effectively the floor for this account.** Staking Wood (>10 HYPE, about $835 at $83.64) gives 5% off → 0.045 × 0.95 × 0.96 = **4.10 bps** (stacking inferred from the fee formula). Bronze (100 HYPE, about $8.35k) gives 3.89 bps. Tier 1 needs >$5M in 14 days. Maker rebates need ≥ 0.5% of venue maker volume. Maker fills would be 1.44 bps (hyperliquid-docs/trading/fees, UNDATED, re-fetched R1). Wood saves about $0.003/trade at $151 notional, so it never pays back. | high (schedule), medium (stacking) |
| 4 | Venue minimums vs our S6 $41 / S1 $52 at $103 (R1 sub-researcher, venue docs and live APIs, 2026-11-03):<br>• **Fit:** Lighter $10 + 0.00007 BTC; Paradex $10; dYdX v4, Extended, Kraken EEA, Deribit USDC-linear all 0.0001 BTC (~$7.7); GMX v2 about $11 (third-party).<br>• **Block us:** Aster and edgeX, 0.001 BTC (~$77).<br>• **Conflict:** OKX EU, 0.0001 BTC on its API vs 0.01 BTC on its help page (~$768). | medium (relayed) |
| 5 | **No public out-of-sample, after-fee evidence** for a BTC squeeze or BBWP breakout. Search returns only forum and vendor figures without a train/test split:<br>• Gainium forum: PF ~1.42, OOS and fees unstated (community.gainium.io/t/strategy-final-squeeze-bot-long-short/4693, undated).<br>• Pineify: PF 1.85 on BTC 4H, generic breakout, no fees or OOS (pineify.app, undated).<br>• TradesViz: PF 0.34 (tradesviz.com/shared/backtests/acbecad1-5a7a-4efa-948c-837954d057e6/, undated).<br>Consistent with chop: 2025 BTC daily realised vol 2.24%, a record low (K33 via spark.money, 2026-09-08). | medium |
| 6 | **cannot (Flash code is out of my reach).** The only in-repo spec is `docs/tradekit-strategy-ideas-from-flash.md:62-65`: 10+ positions at HF 1.01–1.05, imminent debt >$50M, one collateral type. B's heartbeats (imminent 9–14, debt $75–134M) meet the first two most hours yet emit `medium`. So the shipped severity mapping is not the doc's; ask Flash. | low |
| 7 | **No documented weekend maintenance window found.** Search finds the 2025-07-29 14:10–14:47 UTC traffic outage (forklog.com/en/hyperliquid-faces-disruption-amid-traffic-surge/) and a QuickNode nanoreth upgrade on 2026-06-08 08:34–09:04 UTC, a Monday (status.quicknode.com/incidents/xjkkf2790yl1). Neither matches. Ask in Hyperliquid's Discord. | low |

## 5. Flip-check of my Round 1 flips-if lines

| line | satisfied by B? |
|---|---|
| Verdict (a): A2 basket passes | **no**, not run |
| Verdict (b): S6 PF ≥ 1.15 at maker fees | **no.** The opposite: extended OOS PF 0.94; live gross about −$24 against $3.67 fees |
| Verdict (c): funding correction makes S1 negative | **no**, not measured for S1 |
| Verdict (d): idle-cash look-up fails or H declines | **no**, not addressed |
| A1: live fills/funding make S1 negative | **no.** Costs measured tiny; S1 live n=1 |
| A2 (EVALUATE): fails gate | **no**, not run |
| A3 (EVALUATE): S6 test PF < 1.10 at fee 0 | **yes in substance.** B's evidence supersedes the fee-swap rerun. I now hold B's view: **A3 → CLOSED, kill S6** |
| A4 (EVALUATE) | **no** |
| A8–A12 (CLOSED) | **no.** B measured nothing on carry, vaults, OI/flow or listings |
| My R1 correction: matrix "S1 only positive in both windows" was false | **superseded.** On B's 488-day test window S6 (−$21.52) and S1+S6 (−$16.19) are negative, so the claim now holds. I withdraw the correction. |

## 6. Disposition reconciliation

| candidate | A vs B | which evidence wins |
|---|---|---|
| S6 | A3 EVALUATE vs B1 KILL | **B.** 26 live trades plus a 219-trade extended out-of-sample test beat my fixed-notional fee estimate. |
| S1 alone | A1 MONITOR vs B5 EVALUATE / B2 WATCH | **Same view.** S1-only becomes the default after B3; B's crowd-out finding settles it. |
| Multi-asset S1 | A2 vs B6, both EVALUATE | **Merge.** Futures-archive data, ETH/SOL/XRP, my pooled gate, B's effort estimate (4–6h). |
| Maker entries / fee tier | A3 (part) vs B9 CLOSED | **B.** Measured saving is $2.5 over 73 days. |
| Cascade | A5 vs B7, both MONITOR | **Agree.** B's 955 all-`medium` heartbeats confirm it. |
| Bankroll scaling | my H-decision "no top-up unless A2 passes" vs B8 CLOSED | **Consistent.** |

## 7. Net assessment

Build nothing strategic yet. First restore the VPS write path and add an exchange write-path probe (B3). Then switch to
S1-only, and run S6 and alt-coin S1 as paper through B4.

The only research worth spending on is the merged A2/B6 multi-asset S1 backtest on Binance futures data. In parallel,
the A4 look-up checks whether idle USDC can earn its ~4% without disturbing margin.

## 8. Sharpest surviving caveat in my own review

A2 is the only pro-edge thread, and it leans on studies whose rigorous samples end by 2025-03. Those studies used
volatility-targeted top-20 baskets, not one fixed EMA rule on three alts. The gate can fail without contradicting them,
and pass without confirming them.
