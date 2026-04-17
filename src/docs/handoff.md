# Session 19 Handoff — VPS Deployment Planning Complete

**Session:** 19 (2026-04-17)  
**Status:** ✅ Planning complete, all decisions locked, Phase 0 ready to kick off  
**Next session:** Phase 0 implementation (indicator parity audit, Binance data, 12-month backtest)

---

## What Happened This Session

### 1. Strategic Decision Made
**Profitable version approved for VPS deployment** (not demo-for-Krown pitch). Reasons:
- Clear technical path (Hyperliquid + local indicators)
- 5-7 week timeline to live $500 capital
- Drop TradingView MCP entirely (ToS risk, adds complexity, no alpha)
- Binance public data solves the 52-day backtest window limitation

### 2. All 7 Clarifying Questions Answered
Via deep Flash project research (Opus 4.7):
- ✅ Indicator parity: needs 2-3 day audit before Phase 1
- ✅ Strategy selection: backtest all three on 12 months, then decide
- ✅ Backtest data: Binance Data Portal for initial backfill
- ✅ Infrastructure: OCI ARM #2 confirmed safe
- ✅ Capital phasing: $500 live, scale to $1,500 after 50 trades positive
- ✅ Transition: VPS simulation mode 7 days parallel with desktop
- ✅ Monitoring: Telegram + pm2 + Supabase only

### 3. Key Technical Corrections Applied
From Flash project research:
- **52-day limit confirmed REAL** (5000-candle retention cap, not pagination bug)
- **Fee structure fixed** (0.045% taker Tier 0, not "0.025% taker + rebate")
- **SDK corrected** (@nktkas/hyperliquid, not @hyperliquid/sdk which doesn't exist)
- **Indicator validation approach** (technicalindicators <0.1% match if using correct formulas)
- **Binance bulk > REST** (Data Portal 12 files vs 36 REST calls)
- **ARM64 audit** (all packages pure JS, OCI ARM #2 safe)

### 4. Comprehensive Documentation Created
- **IMPLEMENTATION_PLAN.md** — 5-7 week roadmap with Phase 0-4 breakdown
- **NEXT_PHASE_CONTEXT.md** — Current bot state + architecture decisions + Q&A answers
- **SESSION_19_SUMMARY.md** — Complete recap with risk mitigation
- **Memory entries** (3 new) — Hyperliquid venue, indicator parity requirements, 52-day limit

### 5. All Changes Pushed
```
e28be6a Update docs: Session 19 summary + decision log
337dad7 Session 19: VPS deployment planning docs + implementation roadmap
```

---

## Key Decisions Locked

✅ **Venue:** Hyperliquid mainnet (not Drift, which was hacked 2026-04-01)  
✅ **Data:** Hyperliquid WebSocket + local indicators (drop TradingView MCP)  
✅ **Infrastructure:** OCI ARM #2 + pm2 + Supabase + Telegram  
✅ **Strategies:** S1/S2/S3 (validated via 12-month Binance backtest)  
✅ **Phasing:** Phase 0-4 with gates and success criteria defined  
✅ **Capital ramp:** $500 → $1,500 over Phases 3-4  

---

## What's Ready for Phase 0

All groundwork documented. Next session starts with:

### Phase 0.1: Indicator Parity Audit (2-3 days)
- Export 2 weeks BTC 15m from TradingView with all 5 indicators
- Fetch same data from Binance
- Compute locally, diff against TradingView output
- Success: <0.5% divergence after warmup
- Blocker: if >0.5%, fix formula and re-audit

### Phase 0.2: Binance Data Ingest (1-2 days)
- Download 12 months BTCUSDT 15m from Data Portal
- Unzip to ./data/bt-data/
- Validate: no gaps, timestamps correct
- Ready for backtest

### Phase 0.3: Multi-Month Backtest (1 day)
- Modify engine to use Binance data
- Update fees: 0.045% taker, 0.015% maker, 0.09% roundtrip
- Run S1/S2/S3 on 12 months
- Output: which strategies have positive expectancy?
- Gate: if all negative, abort profit version

### Phase 0.4: OCI Readiness (30 min)
- Verify Node 22, pm2, logrotate
- Test build and boot
- Create deployment directory

---

## Critical Files for Next Session

**Documentation (read first):**
- `src/docs/IMPLEMENTATION_PLAN.md` — Phase 0-4 roadmap
- `src/docs/NEXT_PHASE_CONTEXT.md` — Architecture + decisions
- `src/docs/SESSION_19_SUMMARY.md` — This session recap

**Code to prepare:**
- (Next session) `src/backtest/binance-data.ts` — Download and parse Binance data
- (Next session) `src/scripts/validate_indicators.ts` — Parity audit script
- (Phase 1) `src/hyperliquid/candle-consumer.ts` — WebSocket OHLCV consumer
- (Phase 1) `src/indicators/calculator.ts` — Local indicator computation

**Existing code to review:**
- `src/indicators.ts` — Verify stdev is population, EMA is SMA-seeded
- `src/strategy/s1_ema_trend.ts`, `s3_stoch_rsi.ts` — Strategy logic (unchanged in Phase 0-1)
- `src/main.ts` — Will be refactored Phase 1 to remove TradingView MCP

---

## Known Risks & Mitigations

| Risk | Mitigation | Gate |
|---|---|---|
| Indicators diverge from TV silently | Phase 0.1 parity audit <0.5% | Blocker: fix formula if >0.5% |
| 12-month backtest shows all negative | Use fallback strategies (funding arb) | Abort profit version if all neg |
| Testnet P&L unrealistic | Use for infra validation only | Acknowledged, not a blocker |
| WebSocket disconnects mid-trade | Implement 30s reconnect timeout | Monitored Phase 1-4 |
| Funding rates swing ±5-30% annualized | Log separately in Phase 4 | Acknowledged, Phase 4 action |

---

## Timeline Summary

- **Phase 0** (3-4d): Validate indicators, backtest strategies, OCI ready
- **Phase 1** (1-2w): Refactor WebSocket, parallel signal validation
- **Phase 2** (2w): Testnet paper trading
- **Phase 3** (2-3w): $500 live trading
- **Phase 4** (ongoing): Scale to $1,500

**Total: 5-7 weeks to live capital**

---

## Next Session Checklist

- [ ] Read IMPLEMENTATION_PLAN.md (understand Phase 0-4)
- [ ] Read NEXT_PHASE_CONTEXT.md (understand current state)
- [ ] Read SESSION_19_SUMMARY.md (understand decisions)
- [ ] Review NEXT_PHASE_CONTEXT.md "Decision Made" section
- [ ] Start Phase 0.1: Indicator parity audit
- [ ] Create binance-data.ts for Phase 0.2
- [ ] Create validate_indicators.ts for Phase 0.1
- [ ] Run Phase 0 to completion (3-4 days)
- [ ] Gate check: proceed to Phase 1 if all Phase 0 gates pass

---

**Session 19 complete. VPS deployment planning locked and ready. Phase 0 unblocked.**
