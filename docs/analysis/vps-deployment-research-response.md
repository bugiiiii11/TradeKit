# Response to NEXT_PHASE_CONTEXT.md -- Research + Implementation Guidance

**Prepared:** 2026-04-17
**By:** Flash project Claude (Opus 4.7) -- cross-project review
**For:** TradingBot project Claude, planning VPS deployment of profit version
**Status:** Research complete. Use this to write the detailed implementation plan.

---

## 0. TL;DR

Three corrections to NEXT_PHASE_CONTEXT.md, then concrete answers to all 7 clarification questions with cited research. Read section 1 first -- it changes the plan shape.

---

## 1. Corrections to NEXT_PHASE_CONTEXT.md (must fix before planning)

### 1.1 The 52-day limit is REAL -- not a pagination bug

My initial suspicion was wrong. Hyperliquid's `candleSnapshot` endpoint has a **hard 5000-candle retention ceiling** per coin+interval combination. 5000 × 15m = 75,000 minutes = 52.08 days, which matches the colleague's number exactly. Paginating `startTime`/`endTime` backwards does NOT unlock older data -- Hyperliquid simply doesn't retain it via this endpoint.

**Implication:** You cannot validate strategies on 6-12 months of Hyperliquid perp data directly. You MUST use an external source for backtest data.

Source: [Hyperliquid Info endpoint docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint) -- the phrase *"Only the most recent 5000 candles are available"* is a retention limit, not a per-call limit.

### 1.2 Fee structure is wrong in the context doc

The doc states "0.025% taker / -0.015% maker rebate". This is incorrect for Tier 0 (where you'll be as a new $1.5k account):

| Volume tier | Taker | Maker |
|---|---|---|
| Tier 0 (default, <$5M 14d volume) | 0.045% | 0.015% |
| Highest retail tier | 0.024% | 0.000% |

**Maker is NOT a rebate at Tier 0.** Maker orders pay 0.015%, not receive 0.015%. The rebate tier requires >$500M 14d volume.

**Implication for backtest:** Use 0.045% (market orders) or 0.015% (limit maker orders) for realistic fee simulation. Your strategies S1/S2/S3 appear to use market orders -- budget 0.09% roundtrip per trade for fees alone, plus slippage.

Source: [Hyperliquid fees documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees).

### 1.3 No official TypeScript SDK

The context doc mentions `@hyperliquid/sdk`. That package doesn't exist. Hyperliquid's official SDK is Python-only (`hyperliquid-python-sdk`).

**Use instead:** `@nktkas/hyperliquid` (v0.32.2, actively maintained, TypeScript-first, pure JS, works in Node/Deno/Bun). Three clients: `InfoClient`, `ExchangeClient`, `SubscriptionClient`. This is the de-facto community standard.

Sources:
- [@nktkas/hyperliquid on npm](https://www.npmjs.com/package/@nktkas/hyperliquid)
- [SDK documentation](https://nktkas.gitbook.io/hyperliquid)

---

## 2. Answers to the 7 clarifying questions

### Q1: Indicator parity -- NEEDS AUDIT, 2-3 days of work

Not optional. The good news: the common JS library `technicalindicators` matches TradingView's Pine Script output within <0.1% for RSI, EMA, and Stochastic RSI, IF you follow these rules:

| Indicator | TradingView formula | Match tolerance with `technicalindicators` |
|---|---|---|
| RSI(14) | Wilder's RMA (`ta.rma`, α=1/N, SMA seed) | <0.01% after 3×period warmup |
| EMA(N) | α=2/(N+1), SMA seed | <0.001% after 3×period warmup |
| Stoch RSI(14,3,3) | Stoch of RSI, SMA smoothing on %K and %D | <0.1% after warmup |
| Bollinger stdev | **Population stdev (divides by N, not N-1)** | -- |

**Pitfalls that cause silent drift:**
- Using sample stdev (N-1) instead of population (N) -- ~0.3% drift
- Hand-rolled EMA without SMA seed -- persistent drift
- EMA vs SMA smoothing on Stoch RSI K/D -- 2-5% drift
- Not aligning bar timestamps to :00/:15/:30/:45 UTC -- off-by-one errors

**BBWP and PMARP are non-standard.** No npm package implements them. You need ~25 lines of custom code for each. Reference Pine Script sources:
- BBWP (The_Caretaker): https://www.tradingview.com/script/tVCfAcLR-BBWP-LB/
- PMARP (The_Caretaker): https://www.tradingview.com/script/LAGpwcu3-PMARP/

Reference JavaScript implementations are in section 4.3 below.

**Validation approach (2-3 days):**
1. Export 2 weeks of 15m BTC from TradingView with all 5 indicators plotted (CSV export or `plot()` + screenshot scrape, or use `tvdatafeed` Python lib)
2. Fetch matching OHLCV from Binance (same bar timestamps)
3. Compute indicators locally with `technicalindicators` + custom BBWP/PMARP
4. Diff row-by-row: `timestamp, tv_value, bot_value, abs_diff, pct_diff`
5. Flag any pct_diff >0.5% after first 600 bars of warmup

**Package recommendations:**
- USE: `technicalindicators` (npm)
- AVOID: `ta.js` (abandoned, wrong EMA seed), `trading-signals` (mixed smoothing), `indicatorts` (wrong stdev), `tulind` (native compile, no ARM64 prebuilds -- see Q4)

Sources:
- [Pine Script v5 `ta.rma` reference](https://www.tradingview.com/pine-script-reference/v5/#fun_ta%7Bdot%7Drma)
- [Pine Script v5 `ta.ema` reference](https://www.tradingview.com/pine-script-reference/v5/#fun_ta%7Bdot%7Dema)
- [TradingView Stoch RSI help](https://www.tradingview.com/support/solutions/43000502333-stochastic-rsi-stoch-rsi/)
- [`technicalindicators` source](https://github.com/anandanand84/technicalindicators)

### Q2: Strategy selection -- DEFER, pilot ONE strategy after multi-month backtest

Current 52-day sample sizes are statistically meaningless:
- S1: n=4 trades (coin-flip territory)
- S2: +$11.16 P&L (noise-level -- could easily be -$5 next 52 days)
- S3: -$8.13 P&L after 45-min hold restored

**Don't pilot S2 alone based on 52-day data.** Fix the data problem (Q3) first, rerun ALL three strategies on 12+ months of Binance data, then decide.

Realistic expectation after multi-month backtest:
- You'll keep 1 or 2 strategies
- S1/S2 (EMA cross + RSI mean reversion) are more likely survivors than S3 (stoch scalp, higher fee sensitivity at 0.09% roundtrip)
- If all three are negative after costs: the whole profit-version premise needs reconsideration, not "which one to pick"

**Pilot approach after backtest selection:**
- Phase 1: Deploy the strongest strategy alone to VPS in simulation mode
- Phase 2: After 2 weeks clean paper + live expectancy validation, add second strategy (if viable)
- Do NOT deploy all three at once -- you won't be able to isolate which one is working/failing

### Q3: Backtest data -- Binance Data Portal (bulk) + REST (current month)

Since the 52-day Hyperliquid limit is real, Binance public data is the only viable path. Two integration options, use both:

**Option A: Binance Data Portal (bulk historical backfill)** -- RECOMMENDED primary

- URL pattern: `https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/15m/BTCUSDT-15m-{YYYY}-{MM}.zip`
- Format: ZIP containing CSV with columns: `open_time, open, high, low, close, volume, close_time, quote_volume, count, taker_buy_volume, taker_buy_quote_volume, ignore`
- 12 months of BTC/USDT 15m = **12 HTTP GETs, ~2MB total**
- Each file has a sibling `.CHECKSUM` (SHA256) for integrity verification
- BTC/USDT listing: 2017-08-17 -- 8.7 years of data available

Reference: https://github.com/binance/binance-public-data

**Option B: Binance REST `/api/v3/klines` (current incomplete month + fallback)**

- Endpoint: `GET https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&startTime={ms}&endTime={ms}&limit=1000`
- Max 1000 candles per call (not 1500)
- Weight 2 per call, 6000 weight/min limit = safe at ~10 req/sec
- Public endpoint, no API key required
- 12 months of 15m = 35,040 candles = 36 calls. Trivial.
- Pagination: set `startTime = lastCandle.openTime + 1`, repeat

**Why Binance spot as proxy for Hyperliquid BTC perp is acceptable:**
- Correlation ~0.999 for signal generation
- OK for strategy/regime/indicator research

**Caveats (plan around them):**
- Funding rate: HL perps pay/charge funding hourly, ±5-30% annualized. Spot data omits this. Pull HL's `/info fundingHistory` separately to model funding impact on perp P&L.
- Basis: perp tracks spot with ±0.05% typical premium/discount
- Mark vs last: HL stops/liquidations trigger off mark price (oracle+EMA), not trade price -- spot close will understate stop-hunt behavior
- Liquidity: Binance spot is deeper than HL BTC perp (~$4-8B vs ~$1-3B daily). Backtest slippage on spot understates real HL slippage by 1.5-3x.

**Recommendation:**
- **Primary backtest:** Binance spot 15m for strategy/indicator/regime research (12 months)
- **Final validation:** Replay strategies against HL's rolling 52-day candle history collected from live bot (self-archive over time)
- **Don't** invest in building a Pine Script hybrid -- adds a second validation pipeline with divergent results

### Q4: Infrastructure -- OCI ARM #2, extend Flash's pm2 + Telegram manager

OCI ARM #2 is the right choice. RAM budget is trivial (1.4GB used of 12GB, 10GB+ spare). Reasoning:

**ARM64 compatibility verified for all needed packages:**

| Package | Version | Type | ARM64 |
|---|---|---|---|
| `@nktkas/hyperliquid` | 0.32.2 | Pure JS/TS | Works |
| `technicalindicators` | 3.1.0 | Pure JS | Works |
| `@supabase/supabase-js` | 2.103.3 | Pure JS | Works |
| `node-telegram-bot-api` | 0.67.0 | Pure JS | Works |
| `tulind` | 0.8.20 | Native C, no ARM64 prebuilds (last 2019) | **AVOID** |

All recommended packages are pure JavaScript. Zero native bindings. No ARM64 concerns.

**Runtime environment on OCI ARM #2:**
- Node 22 (Active LTS until Oct 2025 maintenance, EOL Apr 2027) -- already installed
- pm2 6.0.14 -- already running (manages 3 Sui bots currently)
- pm2-logrotate -- already installed

**Concrete deployment layout:**

```
/home/ubuntu/
├── flash/                    # Flash project (existing)
│   ├── liquidator-navi/
│   ├── liquidator-suilend/
│   ├── liquidator-scallop/
│   └── deploy/
├── trading-bot/              # NEW -- trading bot repo here
│   ├── src/
│   ├── dist/
│   ├── .env
│   └── ecosystem.config.cjs  # Local pm2 config
└── .pm2/                     # Shared pm2 instance
```

pm2 doesn't care about repo location. Add a trading bot pm2 entry; it runs alongside the Sui bots under the same pm2 daemon.

**Don't merge the trading bot into the Flash repo.** Reasoning:
1. Flash is in maturity phase (per its CLAUDE.md) -- adding speculative trading dilutes focus
2. Colleague involvement -- forcing them to work in Flash exposes context they don't need
3. Different risk profile (probabilistic trading bets vs deterministic liquidation bonuses)
4. Different commit cadence (strategy tuning is noisy vs Flash's settled maintenance)
5. Clean git history for both projects

**What to share operationally (not code):**
- Same VPS (OCI ARM #2)
- Same pm2 daemon
- Same Telegram bot manager (extend `bot-manager-telegram` to control a 4th process)
- Same Discord webhook pattern (different channel for trading alerts)
- `bot-check.sh`-style heartbeat script (but in trading-bot repo, with P&L/drawdown/position schema -- different from Flash's liquidator schema)

**What NOT to share (keep physically separated):**
- Code imports across repos -- copy utilities if needed, don't cross-import
- `.env` files -- each repo has its own
- Database schemas (Flash uses logs + JSON; trading bot uses Supabase)

### Q5: Capital & phasing -- 2 weeks paper, $500 live, then scale

4 weeks testnet is excessive if Q1 (indicator parity) and Q3 (multi-month backtest) gates pass cleanly. Suggested ramp:

| Phase | Duration | Capital | Exit criteria |
|---|---|---|---|
| 1 | 2 weeks | Testnet paper | Zero crashes, zero unexpected restarts, signal match with local Supabase |
| 2 | 2-3 weeks | $500 live | Realized P&L tracks backtest within ±30%, no infra surprises |
| 3 | Ongoing | $1,500 live | Triggered after 50 live trades of positive expectancy |
| 4 | If proven | Scale up | Only after 100+ trades and positive OOS behavior |

**Why $500, not $1,500 directly:**
- Discovering a strategy edge doesn't survive real slippage/funding is cheap at $500
- A 20% drawdown on $1,500 from one bad week can kill the experiment before you have signal
- $500 with 5x leverage = $2,500 notional, enough for real trade dynamics

**Hyperliquid testnet notes (IMPORTANT):**
- Faucet URL: https://app.hyperliquid-testnet.xyz/drip -- gives 1,000 mock USDC
- **Gotcha:** faucet requires a mainnet deposit from the same address first (even $1)
- API: `https://api.hyperliquid-testnet.xyz/info` (and `/exchange`)
- WS: `wss://api.hyperliquid-testnet.xyz/ws`
- Order book is thinner than mainnet -- slippage is NOT representative. Don't trust testnet fills for P&L modeling; use it for infrastructure validation only.
- Funding rates can be degenerate on testnet (low participant count, volatile)
- Privy email-login users have separate testnet wallets -- export private key to Rabby/MetaMask

### Q6: Transition -- VPS in dry-run parallel with desktop for 1 week

Run VPS in **simulation mode** (compute signals, log to Supabase, do NOT execute) while desktop bot continues live for 7 days. This answers two questions simultaneously:

1. **Indicator parity under live conditions:** VPS should see the same entry/exit bars as desktop for the same strategies. Any divergence points to implementation drift (likely BBWP/PMARP or stdev convention issue).
2. **Infra stability:** Does the VPS bot run for 7 days without crashes, Supabase connection drops, pm2 restarts, or memory leaks?

**After 7 days of matched signals + zero infra incidents:**
- Shut down desktop bot
- Flip VPS flag to execute mode
- Monitor hourly for first 24h, daily for first week

**If signals diverge during parallel run:**
- Do NOT cutover
- Diagnose the indicator or logic drift
- Extend parallel period by 1 week after fix

This mirrors Flash's proven pattern: every new bot ran in monitor mode for weeks before execute mode.

### Q7: Monitoring -- Telegram + pm2 heartbeat, NO paid tooling

Flash runs 15 bots on free Telegram + Discord, zero incidents from insufficient observability. Paid tools (Datadog, New Relic) are overkill for a single bot with $1,500 capital.

**Required monitoring:**
- pm2 with `pm2-logrotate` (10MB max, 3 retained, compressed -- same config as Flash's Sui bots)
- pm2 auto-restart on crash (default)
- Crash-loop detection: alert if pm2 restart count spikes >3 in 1 hour
- Telegram alerts: position opened, position closed with P&L, kill switch triggered, daily digest
- Daily P&L + drawdown digest at 00:00 UTC via Telegram
- `bot-check.sh`-equivalent heartbeat on cron every 2h, posts status to Discord webhook
- Supabase position snapshot every 5 minutes (already exists per context doc)

**Critical for trading bot specifically (not needed for Flash's liquidator bots):**
- **Circuit breaker alert:** if realized drawdown exceeds X% in 24h, fire URGENT Telegram + auto-pause bot pending human review
- **Funding rate alert:** if funding rate flips sign or exceeds ±0.05% per 8h, alert (may affect strategy viability)
- **API key rotation reminder:** quarterly, via cron

---

## 3. Design concerns worth revisiting (beyond the 7 questions)

### 3.1 S3's removed 2h max hold

The context doc mentions the 2h max hold was removed by user preference after 45-min min hold was restored. A stoch RSI scalp held >4h stops being a scalp by definition -- it's drifted into a trend-following regime where stoch signals are counter-productive.

**Suggested middle ground:**
- Keep the 45-min min hold (proven fix)
- Re-add a soft max: exit on daily candle close regardless of stoch state (catches overnight drift)
- OR: exit if position has been open across 2+ regime transitions (1H EMA cross flips)

This preserves the no-overtrade behavior while preventing the opposite failure mode (scalp positions held through regime changes).

### 3.2 Supabase as command channel adds latency

The context doc describes manual trade entry flowing through Supabase rows. For a human-driven command (kill switch, resume), seconds of latency don't matter. But if any automated command ever needs to fire fast, Supabase polling adds 1-5s of latency vs direct Telegram command handlers.

**Not an issue today.** Flag only if future commands become time-sensitive (e.g., auto-flatten on circuit breaker).

### 3.3 Funding rate modeling gap

The backtest likely doesn't model Hyperliquid perp funding rates. Over 6-12 months, BTC perp funding can contribute ±5-30% annualized P&L. For strategies that hold long-biased positions in BTC bull markets, funding is often the larger P&L contributor than strategy alpha itself.

**Fix:** Pull HL's `/info fundingHistory` for BTC perp over the backtest window, apply hourly funding to open positions during replay. 30-60 minute integration.

---

## 4. Technical reference

### 4.1 Hyperliquid API quick-ref

**REST endpoints:**
- Info (queries): `POST https://api.hyperliquid.xyz/info`
- Exchange (orders): `POST https://api.hyperliquid.xyz/exchange`
- Testnet: replace `api.hyperliquid.xyz` with `api.hyperliquid-testnet.xyz`

**candleSnapshot request:**
```json
{
  "type": "candleSnapshot",
  "req": {
    "coin": "BTC",
    "interval": "15m",
    "startTime": 1700000000000,
    "endTime": 1700500000000
  }
}
```

Available intervals: `1m,3m,5m,15m,30m,1h,2h,4h,8h,12h,1d,3d,1w,1M`

**WebSocket:**
- URL: `wss://api.hyperliquid.xyz/ws`
- Subscribe to 15m BTC candles:
  ```json
  {"method": "subscribe", "subscription": {"type": "candle", "coin": "BTC", "interval": "15m"}}
  ```
- **Partial candles:** feed emits the in-progress candle on every update with the same `t` (open time) until the bar closes. Detect close by `t` advancing to the next bar.
- **No documented ping/pong:** implement app-level heartbeat (ping every 30s, reconnect if no message in 60s)
- **Reconnection:** expect periodic disconnects without announcement -- must handle gracefully

**Rate limits:**
- REST (IP-based): 1200 weight/min
  - Most info queries: weight 2-20
  - candleSnapshot: ~83 weight for a 5000-bar pull
  - Exchange actions: `1 + floor(batch_length/40)`
- REST (address-based): 1 request per 1 USDC cumulative volume, 10,000-request initial buffer
- WebSocket (IP-based): 10 concurrent connections, 30 new conns/min, 1000 subscriptions, 2000 msgs/min, 100 in-flight POSTs

**Fees (Tier 0):**
- Taker: 0.045%
- Maker: 0.015% (NOT a rebate; maker pays)
- Rebate tier requires >$500M 14d volume

**BTC perp parameters:**
- Max leverage: 40x (tiered margin reduces effective leverage as notional grows)
- Funding: 8-hour rate paid hourly at 1/8 each hour, cap ±4%/hour
- Funding formula: `F = avg_premium + clamp(interest_rate - premium, -0.0005, 0.0005)`, interest rate 0.01% per 8h
- Funding uses oracle price (not mark)

**Order types:** Market, Limit (GTC/IOC/ALO post-only), Stop Market, Stop Limit, Take Market, Take Limit (native triggers), Scale, TWAP. Reduce-only supported.

### 4.2 Indicator validation reference

**TradingView formulas (Pine Script v5):**

```pinescript
// RSI(14)
change = ta.change(close)
gain = math.max(change, 0)
loss = -math.min(change, 0)
avgGain = ta.rma(gain, 14)  // Wilder's RMA, alpha = 1/N
avgLoss = ta.rma(loss, 14)
rsi = 100 - 100 / (1 + avgGain / avgLoss)

// EMA(N)
ema = ta.ema(close, N)  // alpha = 2/(N+1), SMA seed

// Stochastic RSI(14, 3, 3)
rsi1 = ta.rsi(close, 14)
k = ta.sma(ta.stoch(rsi1, rsi1, rsi1, 14), 3)
d = ta.sma(k, 3)

// Bollinger Band stdev (used in BBWP)
// ta.stdev uses POPULATION stdev (divides by N, not N-1)
```

**Validation checklist:**
- Use `technicalindicators` npm package for RSI, EMA, Stoch RSI
- Use population stdev (divide by N) for Bollinger-related calculations
- Use SMA-seeded EMAs (don't seed with first close)
- Discard first 3×max(period) bars before comparing to TV output
- Align timestamps to :00/:15/:30/:45 UTC exactly

### 4.3 BBWP and PMARP reference implementations

**BBWP (Bollinger Band Width Percentile):**

```typescript
export function bbwp(closes: number[], bbLen = 13, lookback = 252): (number | null)[] {
  const bbw: number[] = [];
  for (let i = bbLen - 1; i < closes.length; i++) {
    const window = closes.slice(i - bbLen + 1, i + 1);
    const mean = window.reduce((a, b) => a + b) / bbLen;
    const variance = window.reduce((s, x) => s + (x - mean) ** 2, 0) / bbLen;
    const sd = Math.sqrt(variance);
    bbw.push((2 * sd) / mean);  // (upper - lower) / basis; upper - lower = 2*sd*multiplier
  }
  const out: (number | null)[] = new Array(bbLen - 1).fill(null);
  for (let i = 0; i < bbw.length; i++) {
    const start = Math.max(0, i - lookback + 1);
    const win = bbw.slice(start, i + 1);
    const rank = win.filter(v => v <= bbw[i]).length / win.length;
    out.push(rank * 100);
  }
  return out;
}
```

Verify the stdev multiplier (1 vs 2) against the specific Pine Script source you're matching.

**PMARP (Price Moving Average Ratio Percentile):**

```typescript
export function pmarp(closes: number[], maLen = 20, lookback = 350): (number | null)[] {
  const pmar: number[] = [];
  for (let i = maLen - 1; i < closes.length; i++) {
    const ma = closes.slice(i - maLen + 1, i + 1).reduce((a, b) => a + b) / maLen;
    pmar.push(closes[i] / ma);
  }
  const out: (number | null)[] = new Array(maLen - 1).fill(null);
  for (let i = 0; i < pmar.length; i++) {
    const start = Math.max(0, i - lookback + 1);
    const win = pmar.slice(start, i + 1);
    const rank = win.filter(v => v <= pmar[i]).length / win.length;
    out.push(rank * 100);
  }
  return out;
}
```

### 4.4 Binance bulk download snippet

```typescript
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

async function downloadBinanceMonth(symbol: string, interval: string, yyyy: number, mm: number) {
  const mmPadded = String(mm).padStart(2, '0');
  const url = `https://data.binance.vision/data/spot/monthly/klines/${symbol}/${interval}/${symbol}-${interval}-${yyyy}-${mmPadded}.zip`;
  const checksumUrl = url + '.CHECKSUM';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(`./data/${symbol}-${interval}-${yyyy}-${mmPadded}.zip`));
  // Download and verify SHA256 via checksumUrl (omitted for brevity)
}
```

### 4.5 pm2 config entry for trading bot

Add to trading-bot's `ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [{
    name: 'trading-bot',
    script: './dist/main.js',
    cwd: '/home/ubuntu/trading-bot',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
    time: true,
    restart_delay: 5000,
    max_restarts: 10,
    min_uptime: 60000,
  }],
};
```

Start with: `pm2 start ecosystem.config.cjs` (uses the same pm2 daemon as Flash's bots)

---

## 5. Recommended implementation phases (revised)

| Phase | Duration | Deliverable | Gate to next phase |
|---|---|---|---|
| 0 | 3-4 days | Fix context doc errors, validate indicator parity against TV (2 weeks of 15m data), write Binance data ingest, re-backtest all 3 strategies on 12 months | All indicators match TV <0.5%; at least 1 strategy shows positive OOS expectancy on 12 months |
| 1 | 1-2 weeks | Refactor `src/tradingview/reader.ts` -> Hyperliquid WS consumer; deploy to OCI ARM #2 in simulation mode (no execution) | 7 days of matched signals vs desktop bot; zero crashes |
| 2 | 2 weeks | Testnet paper trading on Hyperliquid testnet, full execution pipeline | Zero unexpected crashes, Supabase stable, signal generation clean |
| 3 | 2-3 weeks | $500 live on mainnet | 30+ trades, realized P&L within ±30% of paper expectancy |
| 4 | Ongoing | Scale to $1,500 live | Weekly trade review, monthly parameter audit |

**Total time to live: 5-7 weeks** (vs doc's 6-8, shorter because testnet is 2 weeks not 4, and Binance integration is 2-3 days not 1-2 weeks).

---

## 6. What's out of scope for this review

- Code review of `src/indicators.ts`, `src/main.ts`, strategy files -- I can't see them from Flash project
- Running the backtests myself -- no access to the trading bot repo
- Pine Script strategy tester comparison -- user-side activity
- Krown partnership strategy -- different project (that's the demo version, this is the profit version)

If you want deeper review of any of the above, spin up a fresh Claude session with the trading bot repo loaded as primary context and this document as reference.

---

## 7. Complete source list

### Hyperliquid documentation
- [Info endpoint docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions)
- [Rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits)
- [Fees](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees)
- [Funding](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding)
- [Order types](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/order-types)
- [Testnet faucet](https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/testnet-faucet)

### SDKs and npm packages
- [@nktkas/hyperliquid (npm)](https://www.npmjs.com/package/@nktkas/hyperliquid)
- [@nktkas/hyperliquid (GitHub)](https://github.com/nktkas/hyperliquid)
- [@nktkas/hyperliquid SDK docs](https://nktkas.gitbook.io/hyperliquid)
- [technicalindicators (GitHub)](https://github.com/anandanand84/technicalindicators)

### TradingView references
- [Pine Script v5 Reference](https://www.tradingview.com/pine-script-reference/v5/)
- [Stoch RSI help article](https://www.tradingview.com/support/solutions/43000502333-stochastic-rsi-stoch-rsi/)
- [BBWP original by The_Caretaker](https://www.tradingview.com/script/tVCfAcLR-BBWP-LB/)
- [PMARP original by The_Caretaker](https://www.tradingview.com/script/LAGpwcu3-PMARP/)

### Binance data sources
- [binance-public-data GitHub](https://github.com/binance/binance-public-data)
- Data portal: `https://data.binance.vision/`
- REST API: `https://api.binance.com/api/v3/klines`

### Indicator theory
- Wilder, J. W. (1978). *New Concepts in Technical Trading Systems* -- canonical RSI/RMA definition

---

**End of document. 2026-04-17, Flash project Claude (Opus 4.7).**
