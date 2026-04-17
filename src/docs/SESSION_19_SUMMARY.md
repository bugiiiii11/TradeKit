# Session 19 Summary — VPS Deployment Planning

**Date:** 2026-04-17  
**Outcome:** Profitable version approved, comprehensive implementation plan drafted, all blockers identified and resolved

---

## What Was Done

### 1. Created Handoff Documentation
- **NEXT_PHASE_CONTEXT.md** — Current bot state, architecture decisions, critical unknowns with detailed answers
- **IMPLEMENTATION_PLAN.md** — 5-7 week phased roadmap (Phase 0-4) with concrete tasks, gates, success criteria

### 2. Resolved All 7 Clarifying Questions
Via deep research from Flash project Claude (Opus 4.7):

| Question | Answer | Impact |
|----------|--------|--------|
| **Q1: Indicator parity** | Needs 2-3 day audit before Phase 1; use technicalindicators <0.1% match if correct formulas | Gates Phase 1 refactoring |
| **Q2: Strategy selection** | Backtest all three on 12 months, then decide; likely only 1-2 survive | Phase 0.3 mandatory gate |
| **Q3: Backtest data** | Binance Data Portal (12 files, 2MB) for 12-month backtest; solves 52-day limit | Phase 0.2 implementation |
| **Q4: Infrastructure** | OCI ARM #2 confirmed safe; all packages pure JS, zero ARM64 concerns | No infrastructure changes needed |
| **Q5: Capital phasing** | $500 testnet → $500 live → $1,500 live after 50 trades positive | Phase 3-4 approach |
| **Q6: Transition** | VPS in simulation mode 7 days parallel with desktop for signal validation | Phase 1.2 approach |
| **Q7: Monitoring** | Telegram + pm2 + Supabase, no paid tooling; funding rate modeling separate | Phase 3+ approach |

### 3. Key Technical Corrections
**From Flash project research:**

1. **52-day limit confirmed REAL** — Hyperliquid `candleSnapshot` returns max 5000 candles (52 days × 15m)
   - Implication: Binance Data Portal required for multi-month validation
   - NOT a pagination bug, hard retention limit

2. **Fee structure wrong in initial context doc**
   - Was: "0.025% taker, -0.015% maker rebate"
   - Correct: "0.045% taker, 0.015% maker at Tier 0"
   - Maker is NOT a rebate, pays 0.015%
   - Use 0.09% roundtrip (0.045% entry + 0.045% exit) for fee modeling

3. **SDK name incorrect**
   - `@hyperliquid/sdk` does not exist (official SDK is Python-only)
   - Correct: `@nktkas/hyperliquid@0.32.2` (community standard, actively maintained, pure TS)

4. **Indicator validation approach**
   - `technicalindicators` npm matches TradingView <0.1% IF:
     - Use population stdev (divide by N, not N-1)
     - SMA-seed EMAs (don't seed with first close)
     - Discard first 3×period bars as warmup
   - BBWP/PMARP: ~25 LOC each, no npm package (reference implementations provided)

5. **Binance bulk download beats REST**
   - Data Portal: 12 HTTP GETs for 12 months (~2MB total, faster)
   - REST API: 36 calls (1000 candles each), same result, slower
   - Both work, use Portal for initial backfill

6. **ARM64 package audit complete**
   - All required packages pure JavaScript
   - No native C bindings, no ARM64 prebuilt issues
   - OCI ARM #2 is safe choice

---

## Decisions Locked

✅ **Profitable version approved** — Not demo-for-Krown (different project if needed)

✅ **Architecture finalized:**
- Venue: **Hyperliquid mainnet** (not Drift, which was hacked 2026-04-01)
- Data source: **Hyperliquid WebSocket + local indicators** (drop TradingView MCP entirely)
- Infrastructure: **OCI ARM #2** (existing, no new VPS needed)
- Strategies: **S1/S2/S3** (validated via 12-month Binance backtest in Phase 0)
- Monitoring: **Telegram + pm2 + Supabase** (no paid tooling)

✅ **Phased approach locked:**
- Phase 0 (3-4d): Validate indicators, ingest Binance data, backtest all strategies, OCI ready
- Phase 1 (1-2w): Refactor TradingView MCP → Hyperliquid WebSocket, parallel signal validation
- Phase 2 (2w): Testnet paper trading, full execution pipeline
- Phase 3 (2-3w): $500 live trading, expectancy validation
- Phase 4 (ongoing): Scale to $1,500 after 50 trades positive

✅ **Success gates defined** for each phase (see IMPLEMENTATION_PLAN.md)

---

## Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Indicator divergence <1% silently breaks signals | Phase 0.1 audit: validate <0.5% parity before refactoring |
| 52-day data window overfits strategies to one regime | Phase 0.3: backtest on 12 months Binance data |
| Testnet P&L not representative (thin order book) | Acknowledged; use testnet for infra validation only, not P&L modeling |
| Funding rates can swing ±5-30% annualized, not modeled | Phase 4 action: log Hyperliquid funding rates separately |
| WebSocket disconnects mid-trade | Implement reconnect with 30s timeout, log all gaps |
| All three strategies negative after backtest | Abort profit version or pivot to funding rate arb fallback |

---

## Next Session: Phase 0 Kickoff

**What to do:**
1. **Indicator parity audit** (2-3 days)
   - Export 2 weeks BTC 15m from TradingView with all 5 indicators
   - Fetch same data from Binance
   - Compute locally with technicalindicators + custom BBWP/PMARP
   - Diff: should be <0.5% after warmup

2. **Binance data ingest** (1-2 days)
   - Download 12 months BTCUSDT 15m from Data Portal
   - Unzip to ./data/bt-data/
   - Validate: no gaps, timestamps correct

3. **Multi-month backtest** (1 day)
   - Modify engine to use Binance data
   - Update fees to 0.045% taker, 0.015% maker
   - Run S1/S2/S3 on 12 months
   - Output: which strategies show positive expectancy?

4. **OCI readiness check** (30 min)
   - Verify Node 22, pm2, logrotate installed
   - Create /home/ubuntu/trading-bot directory
   - Test build and boot

**Blocker gates:**
- If indicator parity >0.5%, fix formula and re-audit
- If all strategies negative, abort profit version
- If OCI infra fails, diagnose and fix

---

## Files Ready for Phase 1

All groundwork docs prepared. Next session will start implementation:

- [x] NEXT_PHASE_CONTEXT.md — Bot state + decisions
- [x] IMPLEMENTATION_PLAN.md — Phased roadmap
- [x] analysis-and-recommendations.md — Strategic overview (existing)
- [ ] (Next session) Binance data ingestion script
- [ ] (Next session) Indicator parity audit script
- [ ] (Next session) Hyperliquid candle consumer refactoring

---

## References

**Key research documents:**
- Flash project Claude research (2026-04-17) — all 7 Q&A with cited sources
- Hyperliquid API docs: https://hyperliquid.gitbook.io/
- Binance Data Portal: https://data.binance.vision/
- @nktkas/hyperliquid SDK: https://nktkas.gitbook.io/hyperliquid
- technicalindicators npm: https://github.com/anandanand84/technicalindicators

**Previous session outputs (Session 18):**
- Manual trade routing fixed (strategy: "manual" tag)
- S3 45-min minimum hold restored with backtest validation
- Supabase trades table retagged (3 manual trades corrected)

---

**Session 19 complete. Planning phase done. Implementation ready to start Phase 0.**
