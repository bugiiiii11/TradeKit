# VPS Deployment Plan — TradingBot Profitable Version

**Timeline:** 5-7 weeks (including indicator parity validation + multi-month backtest)  
**Go-live capital:** $500 (scale to $1,500 after 50 trades of positive expectancy)

---

## Phase 0: Validation & Setup (3-4 days)

**Objective:** Answer critical unknowns before refactoring.

### 0.1 Indicator Parity Audit (2-3 days)

- Install `technicalindicators` v3.1.0
- Write validation script to compare local indicators vs TradingView
- 2 weeks of BTC 15m data minimum
- Success: all pct_diff <0.5% after warmup
- Blocker: if diverges >0.5%, fix formula before Phase 1

### 0.2 Binance Data Ingest (1-2 days)

- Download 12 months BTC/USDT 15m from Binance Data Portal
- Unzip to ./data/bt-data/
- Parse CSV and load into backtest engine
- Validate: no gaps >30m, all timestamps correct

### 0.3 Multi-Month Strategy Backtest (1 day)

- Modify backtest engine to consume Binance data
- Update fees: 0.045% taker, 0.015% maker (Tier 0), total roundtrip 0.14%
- Run all three strategies on 12 months
- Decision: which strategies show positive expectancy?
- Blocker: if all negative, profit version doesn't proceed

### 0.4 OCI ARM #2 Readiness (30 min)

- Verify Node 22, pm2, logrotate installed
- Create /home/ubuntu/trading-bot directory
- Clone repo, npm install, npm run build
- Verify successful boot

---

## Phase 1: Desktop → VPS Signal Parity (1-2 weeks)

**Objective:** Migrate indicator computation from TradingView MCP to Hyperliquid WebSocket.

### 1.1 Refactor Signal Source (3-4 days)

1. Install @nktkas/hyperliquid@0.32.2 (not @hyperliquid/sdk)
2. Create src/hyperliquid/candle-consumer.ts
   - Subscribe to wss://api.hyperliquid.xyz/ws
   - Maintain buffer of 400 bars
   - Emit on bar close
3. Create src/indicators/calculator.ts
   - Use technicalindicators for EMA, RSI, Stoch RSI
   - Custom BBWP/PMARP (~25 lines each)
4. Update src/main.ts: remove TV MCP, add WebSocket
5. Delete src/tradingview/ directory
6. Remove puppeteer/CDP packages

### 1.2 Parallel Operation (7 days)

- Deploy VPS in SIMULATION_MODE=true (no order execution)
- Keep desktop bot running with live orders
- Both read same Supabase database
- Compare signals: should match >95% at same bars
- Monitor: zero pm2 restarts, WebSocket stable
- Exit criteria: 7 days matched + zero crashes → proceed

---

## Phase 2: Testnet Paper Trading (2 weeks)

**Objective:** Full execution pipeline on testnet.

### 2.1 Testnet Setup (30 min)

1. Create testnet wallet (Rabby/MetaMask)
2. Deposit $1 to mainnet from same address (faucet requirement)
3. Claim 1,000 mock USDC from faucet
4. Create .env.testnet with testnet credentials
5. Start bot: `npm start`

### 2.2 Execution Validation (2 weeks)

- Place >30 trades, track all to completion
- Verify order placement → position open → SL/TP set → close
- Test manual controls: kill switch, resume, manual trade entry
- Success: P&L within ±30% of backtest, zero crashes

---

## Phase 3: Live Trading — $500 Ramp (2-3 weeks)

**Objective:** Real capital deployment with position sizing validation.

### 3.1 Deploy to OCI ARM #2

1. Pull latest code, npm install, npm run build
2. Create ecosystem.config.cjs for pm2
3. Set max_memory_restart: 300M
4. Create logs/ directory, configure logrotate
5. pm2 start ecosystem.config.cjs && pm2 save

### 3.2 Live Execution ($500)

- 5x leverage = $2,500 notional per position
- Monitor daily: P&L, drawdown %, trade count
- Success criteria: >30 trades, P&L within ±30% of backtest, kill switch works
- Telegram alerts on entry/exit, daily 00:00 UTC digest

---

## Phase 4: Production — $1,500 Scale (Ongoing)

**Trigger:** 50 live trades of positive expectancy + zero major incidents

- Add $1,000 capital (total $1,500)
- 5x leverage = $7,500 notional per position
- Weekly trade review: win%, avg P&L, strategy mix
- Monthly: any parameter adjustments needed?
- Quarterly: API key rotation

---

## Files to Create/Modify

**New:**
- src/hyperliquid/candle-consumer.ts
- src/indicators/calculator.ts
- src/scripts/validate_indicators.ts
- src/backtest/binance-data.ts
- ecosystem.config.cjs

**Delete:**
- src/tradingview/ (entire directory)

**Modify:**
- src/main.ts (remove TV MCP, add WebSocket)
- package.json (add @nktkas/hyperliquid, remove puppeteer/CDP)

---

## Timeline

- Phase 0: 3-4 days
- Phase 1: 1-2 weeks
- Phase 2: 2 weeks
- Phase 3: 2-3 weeks
- Phase 4: ongoing

**Total to live: 5-7 weeks**

---

## Key Research Findings (from Flash project Claude)

1. **52-day limit is REAL** (confirmed in official Hyperliquid docs)
2. **Fee structure:** 0.045% taker, 0.015% maker at Tier 0 (not -0.015% rebate)
3. **SDK:** Use @nktkas/hyperliquid@0.32.2, not @hyperliquid/sdk (doesn't exist)
4. **Indicators:** technicalindicators npm matches TradingView <0.1% (if using correct formulas)
5. **BBWP/PMARP:** ~25 LOC each, no npm package
6. **Binance bulk download:** 12 files for 12 months (~2MB total) vs 36 REST calls
7. **ARM64:** All packages pure JS, OCI ARM #2 safe

---

See NEXT_PHASE_CONTEXT.md for current bot state and detailed Q&A.
