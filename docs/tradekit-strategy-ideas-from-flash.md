# Strategy Ideas for TradeKit -- From Flash's Research + Live Experience

**Date:** 2026-05-06
**Source:** Flash project (DeFi MEV -- 18 liquidation/trading bots across 8 chains, 4+ months live grid trading)
**Target:** TradeKit S5/S6/S7 candidates on Hyperliquid BTC perps

---

## Strategic Context

### What TradeKit has proven (S1-S4)

- **S1 (EMA Trend)** and **S2 (Mean Reversion within trend)** are the only strategies with positive expectancy on BTC perps. 379-day backtest: +$81, PF >1.0, Sharpe 3.55.
- **S3 (StochRSI scalp):** dead. Net -$82, PF 0.51. Mean-reversion at micro scale doesn't work on BTC.
- **S4 (Grid):** dead. 9 configs tested, all negative. Best was -$6 at 5.3% uptime. BTC trends through any grid range in days.

### What Flash's research confirms

Flash ran 4+ months of live grid trading on Base (ETH/USDC spot) and conducted extensive strategy research across DeFi. Key findings that apply to TradeKit:

1. **BTC perps are structurally trend-following.** Mean-reversion strategies (grid, scalp, range trading) lose money. This is not a parameter problem -- it's a market structure problem. BTC trends for weeks, mean-reverts for hours.

2. **The strategies that work on perps are all trend-following variants.** Different entry signals (EMA cross, pullback, breakout), same ride-the-trend structure. S1 and S2 already prove this.

3. **The next alpha comes from better SIGNALS, not different strategy types.** S5/S6/S7 should be new entry/exit signals fed into the existing trend-following framework, not fundamentally new approaches.

4. **DeFi liquidation cascades are a leading indicator for BTC price.** Flash monitors $6B+ in borrows across 18 bots. When large positions cluster near liquidation thresholds, cascading sell-offs follow within hours. This is signal almost nobody outside DeFi liquidation bots has access to.

5. **Funding rate velocity predicts short-term continuation.** Rapidly changing funding rates signal crowd positioning shifts. This is directly available on Hyperliquid.

---

## S5 Candidate: Cascade Signal Overlay

### The idea

Use DeFi liquidation data as a leading indicator for BTC price drops. When lending protocol positions cluster near liquidation thresholds, a cascade sell-off is imminent. This creates a high-conviction SHORT entry signal.

### How cascades work

DeFi lending (Aave, Morpho, Compound) requires borrowers to maintain collateral above a health factor (HF) threshold. When HF drops below 1.0, anyone can liquidate the position -- forcibly selling the collateral on DEXes. During market drops:

1. BTC/ETH price drops 2-3%
2. Hundreds of positions approach HF=1.0
3. First liquidations fire, dumping collateral on DEXes
4. DEX sells push price lower
5. More positions cross HF=1.0
6. Cascade: self-reinforcing liquidation spiral
7. Peak liquidation volume occurs within 45 minutes of first price spike
8. Flash crashes can see volumes triple in 15 minutes

### The signal

Flash's 18 bots continuously scan borrower health factors across 8 chains:

| Protocol | Chain | Borrows Monitored |
|----------|-------|-------------------|
| Morpho Blue | Base, Ethereum, Monad, HyperEVM, Arbitrum, Katana | ~$4B+ |
| Aave V3 forks | Monad (Neverland), Ink (Tydro), Ethereum (SparkLend), HyperEVM (HyperLend) | ~$2B+ |
| NAVI / Suilend / Scallop | Sui | ~$500M+ |

Cascade signal fires when:
- 10+ positions at HF 1.01-1.05 (IMMINENT zone)
- Aggregate IMMINENT debt > $50M
- Concentrated in one collateral type (e.g., all wstETH or all WBTC)

### How TradeKit would use it

1. Flash fires a webhook (Discord or HTTP) when aggregate IMMINENT count spikes above threshold
2. TradeKit receives the signal
3. If S1's EMA alignment confirms bearish (EMA8 < EMA55), enter SHORT with tight stop
4. Ride the cascade down
5. Exit on S1's normal exit logic (EMA reverse cross or SL)

### Implementation

- **Flash side:** Add a webhook endpoint to the existing Telegram/Discord notification system. Fire when `IMMINENT_count > threshold AND aggregate_debt > $50M`. Already computed every scan cycle -- just needs a new notification channel. ~30 minutes of work.
- **TradeKit side:** Add a webhook listener. Treat cascade signal as an S1-like entry condition with override priority. ~1 session.
- **Plumbing:** Discord webhook is simplest (Flash already has Discord notifications on all bots). TradeKit subscribes to a dedicated `#cascade-signals` channel.

### Characteristics

| Aspect | Value |
|--------|-------|
| Frequency | 2-5x per year (major cascades) |
| Average BTC drop during cascade | 5-15% |
| Expected profit per event (at $400 capital, 3x leverage) | $60-180 |
| Annual expected value | $120-900 |
| Signal lead time | Minutes to hours before peak cascade |
| False positive rate | Medium (positions can be repaid, cascade may not materialize) |
| Unique edge | Almost nobody has real-time cross-chain HF monitoring |

### Historical cascade data (Flash observations)

- **Feb 2026:** $429M liquidated across DeFi in ~12,500 transactions. Largest single: Trend Research $869M ETH ($2.1B position). BTC dropped ~20%, ETH dropped ~17%.
- **Apr 2025 - Apr 2026 (TradeKit backtest window):** 3 major cascade events with >$100M liquidated each.
- After cascades, DeFi borrowers deleverage. Remaining at-risk positions are either abandoned or whales that create the next cascade.

### Risk

- Cascades are infrequent. This is an overlay, not a primary strategy.
- False signals: positions at HF 1.01-1.05 can hover for weeks without cascading (Flash has seen this repeatedly -- e.g., a $20.7M WBTC/cbBTC position sitting at HF=1.0178 for days).
- Need tight stops. If the cascade doesn't materialize, exit quickly.

---

## S6 Candidate: Volatility Breakout (BBWP Expansion)

### The idea

S2 uses BBWP <35 as a "low volatility = pullback entry" filter. The inverse is also a signal: when BBWP expands rapidly from low to high, a breakout is happening. Enter in the direction of the breakout.

### The signal

- **Entry condition:** BBWP crosses above 50 from below 20 (compressed volatility exploding)
- **Direction:** Price above EMA21 on the breakout bar = LONG. Price below EMA21 = SHORT.
- **Stop-loss:** 2% (tighter than S1's 3%, because breakouts either work immediately or fail)
- **Exit:** Same as S1 (EMA reverse cross, or BBWP returning below 35 after hitting >85)

### Why this is different from S1

S1 enters on EMA8/EMA55 cross, which is a lagging indicator -- it confirms the trend AFTER it's been running for a while. BBWP expansion catches the move AS it starts. Different entry timing, potentially better entries on explosive moves.

| Aspect | S1 (EMA Trend) | S6 (Volatility Breakout) |
|--------|----------------|--------------------------|
| Entry timing | After trend establishes (lagging) | As breakout begins (concurrent) |
| Signal | EMA8 crosses EMA55 | BBWP expands from <20 to >50 |
| Best at | Sustained multi-day trends | Explosive breakouts |
| Weakness | Slow entry, misses initial move | False breakouts (volatility without direction) |
| Overlap with S1 | Often confirms same trend 1-3 bars later | Sometimes catches moves S1 misses entirely |

### Implementation

- Already compute BBWP for S2
- New entry logic: ~50 lines
- Same exit framework as S1/S2
- Backtest against existing 24-month BTC data to validate

### Risk

- False breakouts: volatility expands but price reverses. Need the EMA21 directional filter to reduce these.
- Can overlap with S1 entries (both trigger on the same move, just at different times). Need position management to avoid double-sizing.
- BBWP is derived from Bollinger Band width, which is itself derived from price -- so it's not an independent signal source. It's a different VIEW of the same data.

---

## S7 Candidate: Funding Rate Momentum (Entry Filter)

### The idea

Use funding rate velocity as a **confirmation filter** for S1/S2 entries, not as a standalone strategy. When funding rate is rapidly changing, it signals crowd positioning shifts that predict short-term price continuation.

### Background on funding rates (from Flash's research)

Perpetual futures funding rates balance long/short demand:
- **Positive funding:** Longs pay shorts. Market is bullish (too many longs).
- **Negative funding:** Shorts pay longs. Market is bearish (too many shorts).
- **Rate magnitude:** 0.01%/8h is typical neutral. >0.05%/8h is extreme.

Flash's research (March 2026, during BTC crash to $68K):
- BTC funding was ~-0.01%/8h (negative = bearish)
- At small position sizes ($400-500), funding cost/income is negligible (~$4/year)
- **Funding is NOT a cost problem -- it's a SIGNAL**

### The signal

Not the funding rate level, but its **velocity** (rate of change):

| Funding Velocity | Meaning | TradeKit Action |
|------------------|---------|-----------------|
| Rapidly becoming more positive | Crowd piling into longs | Confirm S1 LONG entries |
| Rapidly becoming more negative | Crowd piling into shorts | Confirm S1 SHORT entries (or avoid longs) |
| Stable/flat | No crowd shift | Neutral -- rely on S1/S2 signals alone |
| Extreme then reversing | Crowd capitulation | Contrarian signal -- reversal may be starting |

### How TradeKit would use it

- **S1 entry filter:** Only enter S1 longs when funding velocity is positive or flat (not rapidly declining). Avoid entering longs when funding is collapsing (the trend may be reversing).
- **S2 entry filter:** Only enter S2 pullback buys when funding hasn't collapsed. If funding is deeply negative and accelerating, the "pullback" might be a reversal.
- **Exit acceleration:** If funding velocity flips direction sharply while in a position, tighten stop or exit early.

### Implementation

- Hyperliquid provides native funding rate data (no external API needed)
- Compute funding rate velocity: `(current_rate - rate_N_hours_ago) / N`
- Add as a boolean filter to S1/S2 entry conditions: ~30 lines
- Backtest: need historical Hyperliquid funding data (or Binance funding as proxy)

### Characteristics

| Aspect | Value |
|--------|-------|
| Standalone strategy? | No -- entry filter only |
| Expected improvement | 5-15% fewer false entries (reduces drawdown) |
| Data source | Hyperliquid native (free, real-time) |
| Build effort | ~30 lines of filter logic |
| Backtest effort | Need historical funding data (Binance proxy available) |

### Risk

- Funding rate is a lagging indicator of crowd positioning (it reflects what happened, not what will happen)
- At $400 capital, the actual funding income/cost is negligible -- this is purely a signal play
- Can occasionally filter out valid entries (funding lags price)

---

## What NOT to Build (and Why)

These are ideas from Flash's research that were evaluated and rejected for TradeKit's context:

| Idea | Why not for TradeKit |
|------|---------------------|
| **Grid on any perps pair** | S4 proved this is structurally unviable. BTC perps trend, grids need mean-reversion. |
| **Mean-reversion scalping** | S3 proved this. -$82 over 379 days. |
| **ETH/BTC ratio grid** | Structurally mean-reverting pair, but Hyperliquid doesn't offer it as a single instrument. Synthetic spread (long ETH / short BTC) adds complexity, doubles fees, and is hard to grid efficiently. Curiosity, not priority. |
| **Funding rate arbitrage** | Delta-neutral position to collect funding. At $400 capital = ~$4/year. Not worth the complexity. Only viable at $5K+ and only when rates are sustained in one direction. |
| **DeFi yield strategies** | Leverage looping, Pendle PT, stablecoin LP -- all require DeFi infrastructure (flash loans, lending protocols, AMMs). Wrong domain for TradeKit. Flash's territory. |
| **Cross-exchange arb** | Requires pre-positioned capital on multiple venues. $400 is too small. Professional arbers dominate. |
| **Correlation regime** | BTC correlates with equities/gold differently in different regimes. Too much complexity for marginal signal at $400 capital. Academic, not practical. |
| **Open interest divergence** | OI rising + price flat = aggressive positioning. Interesting signal but hard to backtest (historical OI data is spotty). Lower priority than S5/S6/S7. Could be a future S8 if S5/S6/S7 pan out. |

---

## Recommended Priority

| Priority | Strategy | Build Effort | Expected Impact | Dependencies |
|----------|----------|-------------|-----------------|--------------|
| **S5** | Cascade Signal Overlay | ~1 session (TradeKit) + ~30 min (Flash) | High alpha, low frequency (2-5x/year) | Flash webhook setup |
| **S6** | Volatility Breakout (BBWP) | ~1 session | Medium alpha, complements S1 | None (data already available) |
| **S7** | Funding Rate Momentum | ~0.5 session | Small improvement to S1/S2 win rate | Historical funding data for backtest |

**S6 first** if TradeKit wants quick independent progress (no cross-project dependency).
**S5 first** if the cascade signal edge is more appealing (requires Flash coordination).
**S7 anytime** as a lightweight filter addition.

All three are trend-following at their core, consistent with the S1-S4 finding that BTC perps reward riding trends, not fighting them.

---

## Flash Grid Trading Lessons (Reference)

A separate document with detailed lessons from Flash's 4-month live grid experience is available at:
`c:\work\___research\grid-trading-lessons-flash.md`

Key takeaways already baked into S4's backtest:
1. Rapid momentum detector (3 fills in 60min = pause)
2. Sell-only mode during regime pause
3. Volatility-adaptive spacing tiers
4. Auto-recenter with daily cap
5. State persistence after every fill

These patterns are validated even though S4 grid was killed -- they measurably reduced losses and are reusable for any future strategy that manages multiple concurrent positions.
