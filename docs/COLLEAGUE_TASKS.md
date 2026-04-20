# TradeKit — Colleague Tasks & Architecture Update

> Updated: 2026-04-20 (Session 21)

## Completed Tasks

- [x] Supabase migration (source columns) — done 2026-04-19
- [x] New Hyperliquid API wallet — `0x71BA95B8C7DF0540C144dA46812954F94D7a21C3` (under old master — see note below)
- [ ] TradingView indicator validation — low priority (verification only, not blocking)
- [ ] Wallet separation — choose Option A or B below

## Architecture Decision: Choose Your Path

### Option A: Keep TradingView bot for Krown demo (full separation)

Two fully independent bots, separate capital pools.

**What you need to do:**

1. **Create a new MetaMask wallet** (new address, new seed — store securely)
2. **Send $400-500 USDC to Hyperliquid** from this new wallet
3. **Create an agent wallet** on this new master (trade-only, no withdraw)
4. **Send securely:**
   - New master address (e.g. `0xNEW...`)
   - New agent private key

**Result:**
| | Desktop Bot (demo/Krown) | VPS Bot (production) |
|---|---|---|
| Master wallet | `0x3a8a...` (existing) | NEW address |
| Agent wallet | `0x1BDd...` (existing) | NEW agent |
| Capital | ~$100 | $400-500 |
| Mode | Live or dry-run | Live 24/7 |

The existing agent `0x71BA...` is no longer needed — send the $4.44 back to master.

### Option B: VPS bot only (simplest)

One bot, one account. No TradingView dependency at all.

**What you need to do:**

1. Nothing new — existing wallet `0x71BA...` or `0x1BDd...` works fine
2. Just **fund the account** with the full $500 (the agent wallets share the master balance)
3. We turn off the desktop bot and run only the VPS bot

**Result:**
- One bot (`npm run start:headless`), one master account, $500 capital
- Desktop bot turned off permanently
- No TradingView needed

---

## Strategy Development Workflow (both options)

Regardless of which option you choose, TradingView is used as a **research tool**:

1. You find patterns on TradingView visually
2. Manual-trade them to validate (with $100 or paper)
3. Write down the rules (entry/exit/stop conditions)
4. We code them into the VPS bot as a new strategy
5. Backtest on 12-24 months of Binance data
6. If positive → enable in VPS bot for automated 24/7 execution

When you have strategy ideas, note:
- Entry conditions (which indicators, what values, which timeframe)
- Exit conditions (indicator-based? time-based? TP/SL?)
- Stop distance (% from entry)
- Timeframe (15m, 1H, 4H, 1D)

---

## TradingView Indicator Validation (low priority)

Not blocking deployment. If you have TradingView Desktop running sometime:

1. Launch with CDP: `& "C:\Program Files\WindowsApps\TradingView.Desktop_*\TradingView.exe" --remote-debugging-port=9222`
2. Set PMARP indicator to: **period=20, lookback=350**
3. Run: `npx ts-node src/scripts/validate_indicators.ts`
4. Share the output

---

## Current Bot Status

- **Strategies active:** S1 (EMA Trend, 10x) + S2 (Mean Reversion, 8x)
- **S3 disabled** — confirmed unprofitable over 484 days
- **PMARP:** fixed to period=20, lookback=350
- **Backtest (S1+S2, 379 days):** +$81.24 (+16.2%), Sharpe 3.55, max DD -4.8%
- **Expected trades:** ~50-80 per year (~10 S1, ~50 S2)
- **VPS bot tested:** connectivity confirmed with new wallet
