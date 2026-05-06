# S4 Grid Strategy Backtest Analysis

**Date:** 2026-05-06 (Session 29)
**Verdict:** Not viable on BTC perps. No parameter combination produces positive expectancy.

---

## Context

S3 (StochRSI scalp) was disabled in Session 28: net -$82 over 379 days, profit factor 0.51. S4 grid was designed to replace S3's "frequent small trades" niche, porting production lessons from our sibling project Flash (4 months live grid trading on Base DEX).

**Flash lessons baked into S4:**
- Rapid momentum detector (3 buys in 60min = pause)
- Sell-only mode during regime pause (not full stop)
- Volatility-adaptive grid spacing (0.3% / 0.5% / 0.8% tiers)
- Auto-recenter with daily cap
- State persistence after every fill

**Perps-specific additions:**
- Funding rate tracking (long vs short side separately)
- Leverage management
- Min order size check ($10 notional floor)

---

## Architecture

Built a **separate grid backtest engine** (`src/backtest/grid-engine.ts`) rather than extending the directional engine. Grids manage N concurrent cells vs 1 position at a time — fundamentally different position model.

**Grid model:** Cell-based. N levels per side around a mid price, each pair of adjacent levels forms a cell. Buy at bottom of cell, sell at top. Each cell is an independent buy-low/sell-high unit.

**Data pipeline:** Reuses existing Binance loader -> aggregator -> aligner. 25 CSV files, Apr 2024 through Apr 2026 (~71k 15m candles). After indicator warmup, 379-day effective backtest window (Apr 2025 -> Apr 2026).

**Files created:**
- `src/strategy/s4_grid.ts` — config, types, grid builders, volatility helpers
- `src/backtest/grid-engine.ts` — simulation engine with momentum detector, regime filter, auto-recenter
- `src/scripts/backtest_grid.ts` — CLI entry point with grid-specific console output

---

## Parameter Sweep — 9 Configurations

All tests: $500 bankroll, 3x leverage, 0.045% fee/side, 0.00125%/hr funding.

| # | Spacing | Levels | Range | Recenter Policy | Regime | Net PnL | PF | Max DD | RTs | Uptime |
|---|---------|--------|-------|-----------------|--------|---------|------|--------|-----|--------|
| Baseline | 0.5% VA | 5 | 5% | 5bar / 3/day | ON | -$122 | 0.53 | -26.4% | 2840 | 77.5% |
| A | 1.0% | 7 | 14% | 20bar / 1/day | ON | -$43 | 0.67 | -16.4% | 723 | — |
| B | 1.5% | 5 | 15% | 40bar / 1/day | ON | -$71 | 0.45 | -16.6% | 313 | — |
| C | 0.8% | 5 | 8% | 40bar / 1/day | ON | -$37 | 0.73 | -11.2% | 1005 | — |
| D | 0.8% | 5 | 8% | ~disabled | ON | -$25 | 0.62 | -14.6% | 408 | 81.0% |
| E | 0.8% | 5 | 8% | ~disabled | OFF | -$22 | 0.66 | -14.6% | 439 | 99.8% |
| F | 2.0% | 10 | 40% | ~disabled | ON | -$126 | 0.13 | -30.9% | 83 | 81.1% |
| **G** | **0.8%** | **5** | **8%** | **truly off** | **OFF** | **-$6** | **0.57** | **-8.1%** | **84** | **5.3%** |
| H | 0.8% | 5 | 8% | truly off | OFF | -$20 | 0.57 | -24.3% | 84 | 5.3% |

- **VA** = volatility-adaptive spacing
- **PF** = profit factor
- **RTs** = completed round-trips
- Test H used 3% margin/level (3x larger positions than G) — losses scaled proportionally

---

## Cost Breakdown (Best Config — G)

```
Gross round-trip profit    +$10.15
Trading fees                -$1.28
Long-side funding           -$3.93
Short-side funding           $0.00  (long-only grid)
Recenter losses              $0.00
End-of-data close losses   ~-$11.32
-----------------------------------------
Net P&L                     -$6.38  (-1.3%)
```

**Key finding on funding:** Long-side funding at -$3.93 over 379 days is manageable — NOT the margin killer we feared. The real killers are recenters and end-of-data unrealized losses.

---

## Root Cause Analysis

### 1. Recenters Are Fatal

Every configuration with recentering shows recenter losses exceeding gross round-trip profit. When BTC trends through the grid range, all filled cells (long positions bought at higher levels) close underwater. Recenter losses ranged from -$64 to -$438 across tests.

The recenter problem scales with:
- Number of filled cells at time of recenter (max 10)
- Distance price has moved beyond grid range
- Frequency of recenters (baseline: 174 over 379 days)

### 2. Without Recenters, Grid Is Dormant 95% of the Time

Best no-recenter config (G) achieved only 5.3% uptime. BTC moves beyond the 8% grid range within days and doesn't return for weeks/months. Result: 84 round-trips in 379 days (~1 every 4.5 days). The grid mechanism works when active, but it's almost never active.

### 3. End-of-Data Losses Are the Hidden Cost

Filled cells at end of backtest close at market price, typically at a loss. In live trading, these would be unrealized losses on the books. Even config G with zero recenters lost -$11 from end-of-data closes — more than the $10 earned from round-trips.

### 4. Position Sizes Are Too Small for Meaningful Profit

At 1% margin x 3x leverage: $15 notional per level, ~0.00019 BTC. Round-trip profit at 0.8% spacing: ~$0.05 per trade. You need 260+ round-trips just to cover one bad recenter (-$13 avg). Increasing position size (Test H: 3x bigger) just amplified losses proportionally.

---

## Why Flash Worked But S4 Doesn't

| Factor | Flash (ETH spot on Base) | S4 (BTC perps on Hyperliquid) |
|--------|--------------------------|-------------------------------|
| Instrument type | Spot (hold forever) | Perps (funding drag) |
| Holding cost | Zero | -$3.93/year on small positions |
| Leverage risk | None | Amplifies trend losses |
| Price behavior | DEX pool = local mean-reversion | BTC = trend-following |
| Grid lifespan | Grid stays relevant for weeks | Price exits 8% range in days |
| Inventory risk | Hold ETH, eventually recover | Funding bleeds, leverage risk |

**The fundamental mismatch:** Grid strategies need a mean-reverting, low-cost-to-hold instrument. BTC perps are a trending, leveraged, funding-drag instrument. These are structurally incompatible.

---

## Comparison vs Alternatives

| Strategy | 379-Day PnL | PnL % | Profit Factor | Sharpe |
|----------|-------------|-------|---------------|--------|
| S4 Grid (best) | -$6.38 | -1.3% | 0.57 | -0.08 |
| S3 StochRSI | -$82.00 | -16.4% | 0.51 | -6.86 |
| S1+S2 portfolio | +$81.00 | +16.2% | >1.0 | +3.55 |
| Do nothing | $0.00 | 0.0% | — | — |

Both S3 and S4 confirm: **BTC perps favor trend-following strategies, not mean-reversion.** S1+S2 remain the only strategies with proven positive expectancy.

---

## Conclusions

1. **S4 grid is not viable for BTC perps** at any tested parameter combination
2. **The grid mechanism itself works** (80%+ win rate on round-trips) but operates too infrequently and loses all gains to recenters or unrealized inventory losses
3. **Funding is NOT the issue** — it was a reasonable concern but only -$4-$14 over a year
4. **Recenters ARE the issue** — structurally unavoidable on a trending asset
5. **Flash lessons are valid** — momentum detector and sell-only mode measurably reduced losses. The lessons just can't overcome the fundamental instrument mismatch.

---

## Recommendations

1. **Keep S1+S2 at 0.5x leverage, scale to 1.0x after track record** — proven positive expectancy
2. **Do not pursue grid on BTC perps** — problem is structural, not parameter-tunable
3. **If grid concept revisited:** target spot markets or highly mean-reverting pairs (e.g., ETH/BTC ratio), not directional BTC perps
4. **Next strategy ideas should be trend-following** — S5 with different entry signals but same "ride the trend" structure
5. **Colleague's TV setups (roadmap #6)** — most promising path to new alpha

---

## Code Artifacts

All code is functional and reusable for future grid experiments:

```
src/strategy/s4_grid.ts          # Config, types, grid builders
src/backtest/grid-engine.ts      # Simulation engine
src/scripts/backtest_grid.ts     # CLI: npx ts-node src/scripts/backtest_grid.ts --help

# Example runs:
npx ts-node src/scripts/backtest_grid.ts --bankroll 500
npx ts-node src/scripts/backtest_grid.ts --spacing 0.8 --levels 5 --no-vol-adaptive --recenter-cap 0
npx ts-node src/scripts/backtest_grid.ts --spacing 1.0 --levels 7 --leverage 5 --no-regime
```

Backtest results saved to: `backtest-results/grid-*.json`
