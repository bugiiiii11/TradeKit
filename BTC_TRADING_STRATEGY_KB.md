# BTC Trading Bot — Strategy Knowledge Base

> **Version**: 1.1
> **Last updated**: 2026-04-14
> **Asset**: BTC/USDC perpetual futures
> **Exchange**: Hyperliquid (own L1)
> **Starting bankroll**: $500
> **Leverage**: S1=10x, S2=8x, S3=5x (fixed per strategy)

---

## System architecture

```
TradingView Desktop (indicators + charts)
        │
        ▼
TradingView MCP Server (Chrome DevTools Protocol)
        │
        ▼
Claude Code (strategy engine + risk manager)
        │
        ▼
Hyperliquid SDK (own L1 — order execution)
        │
        ▼
Portfolio tracker (PnL, drawdown, trade log)
```

### Components

- **TradingView Desktop**: Runs locally with `--remote-debugging-port=9222`. Displays BTC chart with all required indicators. Free tier works; paid tier provides real-time data.
- **TradingView MCP Server**: Open-source bridge (`tradesdontlie/tradingview-mcp`). Reads chart data, indicator values, and OHLCV bars programmatically via CDP.
- **Claude Code**: Evaluates strategy conditions, manages risk sizing, generates orders. Reads this file as its decision-making reference.
- **Hyperliquid**: Decentralized perpetual futures exchange running on its own L1. Sub-second finality, no gas fees on trades, up to 40x leverage on BTC. Non-custodial via EVM wallet (MetaMask). Uses an "API wallet" (agent key) for bot trading — the API wallet can place/cancel orders but cannot withdraw funds, isolating bot risk from the main account.

---

## Indicators setup (TradingView)

Add all of the following to a single BTC/USDC chart:

| Indicator | Settings | Purpose |
|-----------|----------|---------|
| EMA 8 | Period: 8, Source: Close | Fast trend (S1) |
| EMA 13 | Period: 13, Source: Close | Fast trend (S1) |
| EMA 21 | Period: 21, Source: Close | Medium trend (S1, S2) |
| EMA 55 | Period: 55, Source: Close | Slow trend (S1, S2) |
| EMA 200 | Period: 200, Source: Close | Macro trend filter |
| RSI | Period: 14, Source: Close | Momentum (S2) |
| Stochastic RSI | K: 14, D: 3, RSI: 14, Stoch: 14 | Scalp signals (S3) |
| BBWP | Period: 13, Lookback: 252 | Volatility percentile (S2) |
| PMARP | Period: 20, Lookback: 350 | Price vs MA percentile (S2) |

### Timeframes by strategy

- **S1 (EMA Trend Cross)**: 4H and Daily — check every 4 hours
- **S2 (RSI + EMA Mean Reversion)**: 1H and 4H — check every hour
- **S3 (Stoch RSI Momentum)**: 15m and 1H — check every 15 minutes

---

## Strategy 1: EMA Trend Cross

**Style**: Swing trading (hours to weeks)  
**Timeframes**: 4H, Daily  
**Inspiration**: Krown's Crypto Cave EMA module

### Logic

This strategy catches major trend moves and lets winners ride until the trend reverses.

#### Long entry — ALL conditions must be true:
1. EMA 8 crosses above EMA 55
2. EMA 13 is above EMA 55
3. EMA 21 is above EMA 55
4. Price is above EMA 200 (macro bullish filter)

#### Short entry — ALL conditions must be true:
1. EMA 8 crosses below EMA 55
2. EMA 13 is below EMA 55
3. EMA 21 is below EMA 55
4. Price is below EMA 200 (macro bearish filter)

#### Exit conditions (ANY triggers exit):
- Reverse cross: EMA 8 crosses back below/above EMA 55
- Stop-loss hit (see risk management)
- Daily drawdown limit reached

### Notes
- This strategy generates few signals but catches large moves
- Historical win rate: approximately 85% (11/13 signals profitable since 2023 per Krown's tracking)
- Average hold time: days to weeks
- Default leverage: 10x (fixed — see sizing rules)
- Do NOT exit early on minor pullbacks — the exit is the reverse EMA cross
- No take-profit orders — indicator-based exit only

---

## Strategy 2: RSI + EMA Mean Reversion

**Style**: Swing/day trading (hours to days)  
**Timeframes**: 1H, 4H  
**Inspiration**: Krown's modified long strategy + RSI EMA module

### Logic

Catches bounces off key moving averages during low-volatility consolidation periods.

#### Long entry — ALL conditions must be true:
1. EMA 21 has crossed above EMA 55 (trend is bullish)
2. BBWP is below 35 (low volatility — compression before expansion)
3. PMARP is below 50 (price is below its average range — room to move up)
4. Price retests the EMA 55 from above (set limit order at EMA 55 level)
5. RSI is between 35–55 (not overbought, has momentum room)

#### Short entry — ALL conditions must be true:
1. EMA 21 has crossed below EMA 55 (trend is bearish)
2. BBWP is below 35
3. PMARP is above 50
4. Price retests the EMA 55 from below
5. RSI is between 45–65

#### Exit conditions (ANY triggers exit):
- **Primary exit**: PMARP closes above 85 then closes back below (most common)
- BBWP closes above 85 (volatility expansion exhausted)
- EMA 21 crosses back below/above EMA 55 (trend reversal)
- Stop-loss: below recent swing low (long) or above recent swing high (short)

### Notes
- Win rate: approximately 50–60% with favorable risk/reward (avg win 1.8%, avg loss 0.55%)
- Works best in ranging/consolidating markets where S1 gives no signals
- Default leverage: 8x (fixed — see sizing rules)
- Requires patience — wait for ALL conditions, do not force entries
- No take-profit orders — indicator-based exit only (PMARP/BBWP/EMA cross)

---

## Strategy 3: Stochastic RSI Momentum Scalp

**Style**: Scalping/day trading (minutes to hours)  
**Timeframes**: 15m, 1H  
**Inspiration**: Krown's proprietary stochastic + RSI EMA approach

### Logic

Catches quick momentum reversals at overbought/oversold extremes.

#### Long entry — ALL conditions must be true:
1. Stoch RSI %K crosses above %D
2. Both %K and %D are below 20 (coming out of oversold)
3. Price is near or above EMA 21 on the 1H (not fighting macro trend)
4. RSI (14) is between 30–50 (confirming oversold but not in freefall)

#### Short entry — ALL conditions must be true:
1. Stoch RSI %K crosses below %D
2. Both %K and %D are above 80 (coming out of overbought)
3. Price is near or below EMA 21 on the 1H
4. RSI (14) is between 50–70

#### Exit conditions (ANY triggers exit):
- Stoch RSI %K crosses back in the opposite direction
- **Take-profit orders (native)**: 33% at +1%, 33% at +3%, 34% at +5% from entry
- Stop-loss: 0.3%–0.5% (tight stops for scalps)
- 2-hour maximum hold time — if not profitable, close at market

### Notes
- Highest frequency strategy — multiple signals per day
- Lower win rate individually but high volume compensates
- Default leverage: 5x (fixed — see sizing rules)
- NEVER hold overnight on this strategy
- Skip signals that contradict S1's active trend direction

---

## Risk management rules

### Per-trade sizing

All trades allocate **5% of current bankroll as margin**, then lever up per strategy.

| Parameter | Value |
|-----------|-------|
| Margin per trade | 5% of current bankroll |
| Example at $500 bankroll | $25 margin |

### Position sizing formula

```
margin_usd   = bankroll × 0.05
position_usd = margin_usd × leverage
position_btc = position_usd / entry_price
risk_dollar  = position_usd × stop_distance_pct  (used for pnl_R tracking)
```

Example: $500 bankroll, S1 signal, 10x leverage, 3% stop:
- Margin = $25
- Notional = $250
- At risk if stop hit = $7.50

### Leverage rules (fixed per strategy)

| Strategy | Leverage | Style |
|----------|----------|-------|
| S1 — EMA Trend Cross | 10x | Trend-follow swing |
| S2 — RSI + EMA Mean Reversion | 8x | Mean-reversion bounce |
| S3 — Stoch RSI Scalp | 5x | Momentum scalp |
| Conflicting signals between strategies | NO TRADE | — |

When multiple strategies fire simultaneously, leverage is determined by the
highest-priority strategy present (S1 > S2 > S3).

### Portfolio-level limits

| Rule | Value |
|------|-------|
| Max concurrent open positions | 3 |
| Max total portfolio exposure | 60% of bankroll at risk |
| Daily drawdown limit | 10% ($50 initially) — pause 24h |
| Weekly drawdown limit | 15% ($75 initially) — pause 48h |
| Consecutive loss limit | 3 losses in a row — pause 4h, review |

### Stop-loss rules (NEVER trade without a stop)

- **S1**: Stop below EMA 55 (or recent swing low), typically 2–4%
- **S2**: Stop below recent swing low or short-term range low, typically 1–2%
- **S3**: Tight stop at 0.3–0.5% (scalp)
- **Trailing stop**: Once trade is 2x the stop distance in profit, move stop to breakeven
- **Lock profits**: When trade reaches 3x risk, trail stop at 1.5x risk distance

---

## Signal confluence scoring

When multiple strategies fire simultaneously, score the signal:

| Confluence | Score | Action |
|------------|-------|--------|
| S1 long + S2 long entry | 8/10 | Enter at S1 leverage (10x) |
| S1 active long + S3 long | 6/10 | Enter at S1 leverage (10x) |
| S2 entry + S3 confirms | 5/10 | Enter at S2 leverage (8x) |
| Single strategy only | 3/10 | Enter at that strategy's leverage |
| S1 long but S3 shows short | 1/10 | Skip (conflicting signals) |
| All 3 bearish simultaneously | 9/10 | Enter at S1 leverage (10x) |

### Macro filter

Before ANY trade, check the 200 EMA on the Daily chart:
- **Price above 200 EMA**: Bias long. Only take short scalps (S3), no short swings.
- **Price below 200 EMA**: Bias short. Only take long scalps (S3), no long swings.
- **Price within 1% of 200 EMA**: Reduced position sizes (50% of normal). Trend unclear.

---

## Execution rules

### Order types
- **S1 entries**: Market order on confirmed candle close (4H or Daily)
- **S2 entries**: Limit order at EMA 55 level (wait for retest)
- **S3 entries**: Market order on Stoch RSI crossover confirmation

### Slippage protection
- Max allowed slippage: 0.1% for market orders
- If slippage exceeds 0.1%, cancel and retry on next candle
- For limit orders (S2), set order 0.05% below EMA 55 for longs

### Trade logging

Every trade must be logged with:
```json
{
  "timestamp": "ISO-8601",
  "strategy": "S1|S2|S3",
  "direction": "long|short",
  "entry_price": 0.00,
  "stop_loss": 0.00,
  "take_profit": null,
  "leverage": 0,
  "position_size_usd": 0.00,
  "margin_used_usd": 0.00,
  "risk_percent": 0.00,
  "confluence_score": 0,
  "exit_price": null,
  "exit_reason": null,
  "pnl_usd": null,
  "pnl_percent": null,
  "notes": ""
}
```

---

## Setup checklist

### Phase 1: Infrastructure
- [ ] Install TradingView Desktop
- [ ] Install Claude Code (if not already)
- [ ] Clone and configure TradingView MCP server
- [ ] Set up MetaMask (or other EVM wallet)
- [ ] Bridge/withdraw USDC to Arbitrum One ($500)
- [ ] Deposit USDC to Hyperliquid via app.hyperliquid.xyz
- [ ] Generate Hyperliquid API wallet (agent key) for bot trading

### Phase 2: Indicators and backtesting
- [ ] Add all indicators to BTC/USDC chart in TradingView
- [ ] Write Pine Script for S1 (EMA Trend Cross) and backtest
- [ ] Write Pine Script for S2 (RSI + EMA Mean Reversion) and backtest
- [ ] Write Pine Script for S3 (Stoch RSI Momentum) and backtest
- [ ] Validate backtest results — target: positive expectancy on each

### Phase 3: Automation
- [ ] Build Hyperliquid execution module (TypeScript SDK)
- [ ] Build risk manager module
- [ ] Build trade logger
- [ ] Connect TradingView signals to Claude Code to Hyperliquid pipeline
- [ ] Go live with real capital ($500)

### Phase 4: Optimization (ongoing)
- [ ] Review trade log weekly
- [ ] Adjust parameters if win rate drops below 40%
- [ ] Add new assets (ETH, SOL) once BTC is consistently profitable
- [ ] Scale bankroll and position sizes as profits grow

---

## Future expansions

- **Additional assets**: ETH/USDC, SOL/USDC perpetuals on Hyperliquid
- **Additional strategies**: Bollinger Band squeeze, VWAP anchored, volume profile
- **Sentiment layer**: RSS/Reddit sentiment via MCP integration
- **Multi-timeframe confirmation**: Higher timeframe trend as gate for lower timeframe entries
- **Auto-compounding**: Reinvest profits by recalculating bankroll after each winning trade

---

## Glossary

| Term | Definition |
|------|-----------|
| EMA | Exponential Moving Average — gives more weight to recent prices |
| RSI | Relative Strength Index — momentum oscillator, 0–100 scale |
| Stoch RSI | Stochastic applied to RSI values — more sensitive momentum oscillator |
| BBWP | Bollinger Band Width Percentile — current volatility vs history |
| PMARP | Price-MA Ratio Percentile — price distance from MA vs history |
| Perp | Perpetual futures contract — no expiry, uses funding rate mechanism |
| Confluence | Multiple independent signals agreeing on the same direction |
| Drawdown | Peak-to-trough decline in portfolio value |
| MCP | Model Context Protocol — bridge between AI tools and external services |
| CDP | Chrome DevTools Protocol — debugging interface for Chromium apps |

---

*Disclaimer: This strategy is for educational and personal use. Crypto trading with leverage carries significant risk including total loss of capital. Past backtest performance does not guarantee future results. Never trade with money you cannot afford to lose.*
