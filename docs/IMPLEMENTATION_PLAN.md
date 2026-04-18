# VPS Deployment Plan — Two-Bot Architecture

**Timeline:** 5-7 weeks (including indicator parity validation + multi-month backtest)  
**Go-live capital:** $500 per bot (scale to $1,500 after 50 trades of positive expectancy)

---

## Architecture: Two Independent Bots

The VPS headless bot runs **alongside** the TradingView desktop bot — not as a replacement.

| | Desktop Bot | VPS Bot |
|---|---|---|
| Entry point | `src/main.ts` | `src/main-headless.ts` |
| Signal source | TradingView MCP (CDP port 9222) | Hyperliquid WebSocket + local indicators |
| Runtime | PowerShell on Windows desktop | pm2 on OCI ARM VPS |
| Wallet | `0x1BDd4abA...` (existing API wallet) | NEW API wallet (trade-only, no withdraw) |
| Capital | ~$500 USDC | $500 USDC (funded separately) |

**Shared:** strategy code, execution layer, risk management, Supabase database (tagged by `source: "tv-bot"` / `"vps-bot"`).

**DO NOT** delete `src/tradingview/`, `src/mcp/`, or modify `src/main.ts` during the VPS build.

---

## Phase 0: Validation & Setup (3-4 days)

**Objective:** Answer critical unknowns before building the headless bot.

### 0.1 Indicator Parity Audit (1 day)

- Script: `src/scripts/validate_indicators.ts`
- Compare locally computed indicators vs TradingView for all 4 timeframes
- Uses existing hand-rolled indicators from `src/backtest/indicators.ts`
- PMARP parameter sweep: code defaults (50,200) vs Strategy KB (20,350)
- Warmup: 600+ bars minimum per timeframe (consultant correction)
- Success: all indicators within 0.5% of TradingView after warmup

### 0.2 Binance Data Ingest (1 day, parallel with 0.1)

- Script: `src/scripts/download_binance.ts`
- Loader: `src/backtest/binance-loader.ts`
- Download 12 months BTC/USDT 15m from Binance Data Vision
- Aggregate 15m → 1H/4H/1D via `src/backtest/aggregator.ts`
- Validate: no gaps >30m, all timestamps correct

### 0.3 Multi-Month Strategy Backtest (1 day)

- Script: `src/scripts/backtest_binance.ts`
- Fee: 0.045% taker per side (0.09% round-trip, Tier 0)
- Funding: 0.00125%/hr applied hourly to open positions
- Slippage: modeled separately from fees (configurable BPS)
- Run all three strategies on 12 months
- Decision gate: which strategies show positive expectancy (>15 trades minimum)?
- Blocker: if all negative, VPS bot doesn't proceed

### 0.4 OCI ARM #2 Readiness (30 min)

- Verify Node 22, pm2, logrotate installed
- Create /home/ubuntu/trading-bot directory
- Clone repo, npm install, npm run build
- Verify successful boot

---

## Phase 1: Build Headless Bot (1-2 weeks)

**Objective:** Create `main-headless.ts` with Hyperliquid WebSocket signal source.

### 1.1 Promote Indicators (1 day)

- Move indicators from `src/backtest/indicators.ts` to `src/indicators/calculator.ts`
- Re-export from `src/backtest/indicators.ts` for backward compatibility

### 1.2 WebSocket Infrastructure (3-4 days)

- `src/ws/candle-consumer.ts` — Subscribe to 15m WS, maintain 600-bar buffer
  - Detect bar close by `t` field advancing (never act on partial candles)
  - Aggregate to 1H/4H/1D via `src/backtest/aggregator.ts`
  - Compute indicators on bar close
- `src/ws/reconnect.ts` — Heartbeat (ping 30s), reconnect if no message 60s
  - On reconnect: fetch missed bars via REST, re-aggregate, resume

### 1.3 Headless Entry Point (2-3 days)

- `src/main-headless.ts` — Mirrors `main.ts` but:
  1. REST warmup (600 bars of 15m history) on startup
  2. Compute initial 1H/4H/1D + indicators
  3. WS subscribe → on bar close → aggregate → indicators → evaluate → execute
  4. Uses VPS bot's own API wallet
  5. Tags all Supabase writes with `source: "vps-bot"`

### 1.4 Parallel Operation (7 days)

- Deploy VPS bot in SIMULATION_MODE=true (no order execution)
- Keep desktop bot running with live orders
- Both read same Supabase database
- Compare signals: should match >95% at same bars
- Monitor: zero pm2 restarts, WebSocket stable
- Exit criteria: 7 days matched + zero crashes → proceed

---

## Phase 2: Testnet Paper Trading (2-3 weeks)

**Objective:** Full execution pipeline on testnet.

### 2.1 Testnet Setup (30 min)

1. Create testnet wallet (Rabby/MetaMask)
2. Deposit $1 to mainnet from same address (faucet requirement)
3. Claim 1,000 mock USDC from faucet
4. Create .env.vps-testnet with testnet credentials
5. Start bot: `npm run start:headless`

### 2.2 Execution Validation (2-3 weeks)

- Place >15 trades (realistic for calm market — consultant correction)
- Verify order placement → position open → SL/TP set → close
- Test manual controls: kill switch, resume, manual trade entry
- Success: P&L within ±30% of backtest, zero crashes

---

## Phase 3: Live Trading — $500 Ramp (2-3 weeks)

**Objective:** Real capital deployment with VPS bot's own wallet.

### 3.1 Wallet Setup

1. Create new API wallet on Hyperliquid (trade-only, no withdraw)
2. Fund with $500 USDC from master MetaMask wallet
3. Set up `.env.vps` with VPS bot credentials

### 3.2 Deploy to OCI ARM #2

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'trading-bot',
    script: './dist/main-headless.js',
    cwd: '/home/ubuntu/trading-bot',
    max_memory_restart: '300M',
    restart_delay: 5000,
    max_restarts: 10,
    min_uptime: 60000,
    env: { NODE_ENV: 'production' },
  }],
};
```

### 3.3 Live Execution ($500)

- Monitor daily: P&L, drawdown %, trade count
- Success criteria: >30 trades, P&L within ±30% of backtest, kill switch works
- Telegram alerts on entry/exit, daily 00:00 UTC digest

---

## Phase 4: Production — $1,500 Scale (Ongoing)

**Trigger:** 50 live trades of positive expectancy + zero major incidents

- Add $1,000 capital (total $1,500)
- Weekly trade review: win%, avg P&L, strategy mix
- Monthly: parameter adjustments needed?
- Quarterly: API key rotation

---

## File Structure (Phase 1 target)

```
src/
  main.ts                 ← KEEP: TradingView desktop bot (unchanged)
  main-headless.ts        ← NEW: Hyperliquid WS + local indicators (VPS)

  strategy/               ← SHARED: S1/S2/S3, confluence
  hyperliquid/            ← SHARED: orders, account, client
  risk/                   ← SHARED: manager, sizing, state
  db/                     ← SHARED: Supabase
  commands/               ← SHARED: kill switch, resume, manual trade

  indicators/             ← NEW: promoted from backtest/
    calculator.ts         ← EMA, RSI, StochRSI, BBWP, PMARP

  ws/                     ← NEW: WebSocket infrastructure (headless only)
    candle-consumer.ts    ← 15m WS, 600-bar buffer, bar close detection
    reconnect.ts          ← Heartbeat, reconnection, REST gap-fill

  tradingview/            ← KEEP: reader.ts (desktop bot only)
  mcp/                    ← KEEP: client.ts (desktop bot only)

  backtest/               ← SHARED: engine, aligner, reporter, aggregator
    indicators.ts         ← Re-exports from src/indicators/calculator.ts
    aggregator.ts         ← 15m → 1H/4H/1D (reused by ws/candle-consumer.ts)
    binance-loader.ts     ← Binance CSV parser
```

---

## Supabase: Shared Database, Tagged by Source

Both bots write to the same tables with a `source` field:
- Desktop bot: `source: "tv-bot"`
- VPS bot: `source: "vps-bot"`

Dashboard shows combined and per-bot views. The `bot_commands` table needs a `target` field to route commands to the correct bot.

---

## Key Research Findings

1. **52-day candle limit is REAL** (confirmed in Hyperliquid docs)
2. **Fee structure:** 0.045% taker, 0.015% maker at Tier 0
3. **Fee roundtrip:** 0.09% (two market orders), NOT 0.14%. Model slippage separately
4. **SDK:** @nktkas/hyperliquid (not @hyperliquid/sdk)
5. **Indicators:** hand-rolled in codebase, match TradingView <0.5% (no npm package needed)
6. **BBWP/PMARP:** ~25 LOC each, custom implementations
7. **Candle buffer:** 600 bars minimum (EMA200 warmup + PMARP lookback)
8. **Multi-TF:** compute higher TFs from 15m aggregation (one WS subscription)
9. **Partial candles:** detect bar close by `t` advancing, never act on partials
10. **Warmup on startup:** REST candleSnapshot for 600 bars, then WS for live
11. **Funding rate:** ±5-30% annualized, model in backtests
12. **WebSocket reconnection:** ping 30s, reconnect 60s, REST gap-fill
13. **ARM64:** all packages pure JS, OCI ARM safe

---

See NEXT_PHASE_CONTEXT.md for current bot state and detailed Q&A.
