pe# Grid Trading Lessons from Flash (ETH/USDC + cbBTC/USDC on Base)

Live since session 112 (~4 months). Spot AMM grid on UniswapV3 (Base). Two bots: ETH/USDC and cbBTC/USDC, both $12 orders, 10 levels per side.

---

## 1. Grid Spacing: Fixed % with Volatility-Adaptive Tiers

**Approach:** Fixed percentage spacing (default 0.5%), dynamically adjusted by a regime filter based on 14-day close-to-close volatility.

| Volatility | Tier | Spacing |
|---|---|---|
| <1% daily | low | 0.3% |
| 1-3% daily | normal | 0.5% |
| >3% daily | high | 0.8% |

**Why not ATR:** ATR requires reliable OHLC candle data. On-chain spot grids use pool `slot0` price (single point) -- no native ATR. We use CoinGecko daily candles for the EMA/vol calculation (fetched once/day, cached). For Hyperliquid perps you'll have native candle data from the exchange, so ATR is viable and probably better than our CoinGecko workaround.

**Key insight:** Spacing too tight (0.2-0.3%) = you get slippage-eaten by AMM fees. Spacing too wide (1%+) = you rarely fill. The 0.5% default works because Base UniV3 has 0.05% pool fee -- gives ~0.4% net margin per round-trip. For Hyperliquid perps, your floor is `2 * (maker_fee + spread)`.

---

## 2. Regime Filter: Yes, Absolutely Critical

**Two mechanisms that saved us from bag accumulation:**

### A. Daily EMA regime (catches multi-day trends)

- 5d / 21d / 21-week (147d) EMAs
- Macro direction: price vs 21-week EMA (bullish/bearish)
- Trend detection: price >2% from 5d EMA AND 5d/21d gap widening >10% over 3 days
- **Action when trending:** sell-only mode (close existing positions, block new buys)
- **Macro flip** (bullish<->bearish): immediate pause regardless of other conditions

### B. Rapid momentum detector (catches intraday crashes)

- Count buy fills in a rolling window (default: 60 minutes)
- If >= 3 buys fire in 60 min: **auto-pause immediately**
- This catches flash crashes MUCH faster than the daily EMA (which only updates every 6h)

**Key lesson:** The rapid momentum detector is what actually saved us. The EMA catches slow bleeds, but the momentum detector catches the -5% in 2 hours scenarios where you'd fill 5-8 levels before the EMA even re-evaluates. **Build the momentum detector first, EMA second.**

### DCA during pause

When regime-paused, we allow one controlled DCA buy per interval (default 24h). Lets you average down slowly rather than going fully dark during extended trends. Optional but psychologically useful.

---

## 3. Inventory Buildup When Price Trends Away

**Three defenses, layered:**

1. **Rapid momentum detector** (immediate): 3 buys in 60min = pause. Stops the bleeding within minutes.

2. **Auto-recenter with daily cap:**
   - If price exits grid range for >5 minutes: recenter grid on current price
   - Max 3 auto-recenters per day
   - If cap hit: pause entirely until manual intervention
   - Orphaned bought positions stay in wallet (unrealized loss, not locked)

3. **Daily loss limit:** configurable max daily loss (default $25). If cumulative round-trip losses exceed this, hard pause.

**What we DIDN'T build (but you might want for perps):** position-size scaling. Our spot grid uses fixed $12 per level. For leveraged perps, you'd want to reduce position size as inventory builds (e.g., if you're already long 3 levels, cut size on the 4th). Leverage makes the bag problem worse -- Flash spot can just hold ETH forever; perps have funding drag.

---

## 4. Backtest-to-Live Surprises

### Slippage is not a constant
Backtest assumed fixed slippage (0.3%). Reality: slippage varies with time of day, gas conditions, and pool depth. Some sells that looked profitable in backtest executed at breakeven or tiny loss. **Mitigation:** we added `maxSlippage` config (0.3%) and reject executions that would exceed it.

### State persistence is non-negotiable
Bot crashes, VPS reboots, RPC timeouts -- all happen. Grid state (which levels are bought, at what price) must persist to disk after EVERY state change. We use a JSON file (`data/grid-state.json`) saved synchronously after each fill. Without this, a restart loses all position tracking and you can't sell what you bought.

### Regime filter needs graceful degradation
CoinGecko API goes down, returns garbage, or rate-limits you. The regime filter MUST work with stale/cached data rather than crashing the bot. We cache candles and fall back to last-known-good if fetch fails. For Hyperliquid, you'll have exchange-native candles (more reliable) but still need this pattern.

### Sell-only mode during pause, not full stop
Early version paused ALL trading during regime detection. Problem: you're sitting on bought positions that could be profitably sold during a bounce. Fix: "sell-only mode" -- sells of existing positions always allowed, only new buys blocked. **This was the single biggest improvement to live P&L.**

### Order execution is not atomic
In backtest, buy+sell happen instantly. Live, a buy might succeed but the sell an hour later might fail (RPC down, gas spike). Design for partial state: a level can be "bought" for hours/days before the sell triggers. Don't assume round-trips complete in the same cycle.

### Gas costs eat margins at small sizes
$12 orders on Base (0.000001 ETH gas) = negligible. But if you're on a chain with higher gas, your order size floor is `gas_cost / expected_margin_per_trade * safety_factor`. For Hyperliquid: no gas concern (0 gas fees), but maker/taker fees replace this as the floor.

---

## 5. Architecture Recommendations (for TradeKit perps grid)

Based on what worked:

| Aspect | Flash implementation | Recommendation for perps |
|---|---|---|
| State | JSON file, save after every fill | Same -- or SQLite if you want trade history |
| Polling | 10s interval, pool slot0 | WebSocket if Hyperliquid offers it (faster fill detection) |
| Regime | CoinGecko daily candles | Use exchange candles directly (1h or 4h) |
| Notifications | Telegram + Discord (errors/trades/status channels) | Same pattern -- essential for unattended VPS |
| Paper mode | Full dry-run mode with simulated fills | Critical for testing. Run paper 24-48h before execute. |
| Pause/resume | Telegram commands (/pause /resume) | Same -- you'll want manual override |
| P&L tracking | In-grid state (totalPnl, dailyPnl, per-trade) | Same + realized vs unrealized (perps have mark price) |

**Perps-specific additions Flash doesn't need:**
- Funding rate tracker (long-biased grid pays funding in contango)
- Leverage management (reduce leverage as inventory builds)
- Liquidation price monitor (the thing spot grids never worry about)
- Mark vs index price (use mark for P&L, index for grid levels)

---

## TL;DR -- Top 5 Lessons

1. **Build the rapid momentum detector FIRST.** It's 20 lines of code and prevents 80% of bag accumulation.
2. **Sell-only mode during trend, not full pause.** Let profitable sells still close.
3. **State persistence after every single fill.** Crashes happen; lost state = lost money.
4. **Auto-recenter with a daily cap.** Don't let the grid chase price forever, but don't make it rigid either.
5. **Paper mode for 24-48h before execute.** Every single time. The bugs you find are never the ones you expect.
