# TradeKit — Colleague Tasks & Architecture Update

> Updated: 2026-04-20 (Session 21)

## Completed Tasks

- [x] Supabase migration (source columns) — done 2026-04-19
- [x] New Hyperliquid API wallet — `0x71BA95B8C7DF0540C144dA46812954F94D7a21C3`, $4.44 funded
- [ ] TradingView indicator validation — low priority now (see below)

## Updated Architecture Decision

**We're moving to a single VPS bot as the main production bot.** The TradingView desktop bot becomes a demo/presentation tool only (for Krown etc).

```
┌─────────────────────────────────┐     ┌──────────────────────────────┐
│  VPS Bot (PRODUCTION)           │     │  Desktop Bot (DEMO ONLY)     │
│  src/main-headless.ts           │     │  src/main.ts                 │
│  Hyperliquid WebSocket + local  │     │  TradingView MCP + CDP       │
│  indicators. 24/7, no GUI.      │     │  Dry-run or small capital.   │
│  Capital: $400-500              │     │  Capital: $0-100             │
│  npm run start:headless         │     │  npm start                   │
└─────────────────────────────────┘     └──────────────────────────────┘
```

**Strategy development workflow:**
1. You (colleague) find patterns on TradingView visually
2. Manual-trade them with $100 to validate
3. Write down the rules (entry/exit/stop)
4. We code them into the VPS bot as a new strategy
5. Backtest on 12-24 months of Binance data
6. If positive → enable in VPS bot for automated 24/7 execution

This way TradingView is a **research tool**, not a production dependency.

## What's Next

### Immediate: Fund VPS wallet for live testing

The VPS bot works (tested with your new wallet — connectivity confirmed). But $4.44 is below Hyperliquid's minimum order size (~$10 notional). To actually place trades:

**Send ~$100-400 more to the VPS wallet** (same Hyperliquid account, the agent wallet `0x71BA...` operates on the master account `0x3a8a...`).

Once funded: we start the bot live with S1+S2 strategies and monitor.

### Low Priority: TradingView Validation

The indicator validation script (`validate_indicators.ts`) is nice-to-have but not blocking. We already confirmed correct parameters via backtesting (PMARP 20/350). If you have TradingView Desktop running sometime:

1. Set PMARP indicator to: period=20, lookback=350
2. Run `npx ts-node src/scripts/validate_indicators.ts`
3. Share the output

But this can wait — it's verification, not blocking.

### Strategy Ideas (your domain)

When you find interesting setups on TradingView, note:
- Entry conditions (which indicators, what values, which timeframe)
- Exit conditions (indicator-based? time-based? TP/SL?)
- Stop distance (% from entry)
- What timeframe you see it on

We can then backtest it on 24 months of data and potentially add it to the VPS bot.

## Current Bot Status

- **Strategies active:** S1 (EMA Trend, 10x) + S2 (Mean Reversion, 8x)
- **S3 disabled** — confirmed unprofitable over 484 days of backtesting
- **PMARP:** fixed to period=20, lookback=350 (Strategy KB values)
- **Backtest result (S1+S2, 379 days):** +$81.24 (+16.2%), Sharpe 3.55, max DD -4.8%
- **Expected trades:** ~50-80 per year (~10 from S1, ~50 from S2)
