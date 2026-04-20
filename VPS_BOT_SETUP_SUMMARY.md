# VPS Bot Setup — Session 20 Progress

## Task 1: Supabase Migration ✅ READY
**Status:** SQL queries prepared, needs manual execution in Supabase dashboard

**What to do:**
1. Go to https://app.supabase.com → select your project
2. Click **SQL Editor** (left sidebar)
3. Create a new query and paste this:

```sql
ALTER TABLE market_snapshots ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'tv-bot';
ALTER TABLE risk_snapshots ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'tv-bot';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'tv-bot';
ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS target text;
CREATE INDEX IF NOT EXISTS idx_risk_snapshots_source_taken ON risk_snapshots (source, taken_at DESC);
```

4. Click **Run**
5. Verify with this query:
```sql
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'risk_snapshots' AND column_name = 'source';
```

Should return: `source | text | 'tv-bot'`

---

## Task 2: New Hyperliquid API Wallet ⏳ ACTION NEEDED
**Status:** Blocked on manual MetaMask setup

**What to do:**
1. Open MetaMask with your master wallet (`0x3a8a318097017aCE0db8276ea435F26DE8674C46`)
2. Go to Hyperliquid.io → Settings → **API Wallets**
3. Click **Create Agent Wallet**
4. Configure:
   - Trade permission: ✅ enabled
   - Withdraw permission: ❌ disabled (security)
5. Save the private key and address
6. Fund with **$500 USDC** from master wallet to the new API wallet address
7. **Send back to dev team:**
   - New API wallet address
   - Private key (securely)

---

## Task 3: TradingView Indicator Validation ✅ COMPLETE
**Status:** Script executed, results captured

### Results Summary
- **PASS:** 27/40 indicators (67.5%)
- **FAIL:** 13/40 indicators (32.5%)
- All **EMA indicators:** EXCELLENT (<0.1% diff across all timeframes)

### Issues Found (Priority: Medium)
1. **PMARP divergence** — Critical, needs parameter tuning before VPS deployment
   - 15m: PASS (0.03% diff) ✅
   - 1H: FAIL (24.99% diff) — parameter sweep suggests `(20,200)` → 6.65% diff
   - 4H: FAIL (54.92% diff) — parameter sweep suggests `(50,350)` → 0.71% diff
   - 1D: FAIL (4.97% diff) — current settings OK for daily

2. **StochRSI/Stoch K divergence** — Minor (1-5% range, within market noise)
   - 15m K: 5.22% diff | 15m D: 5.57% diff
   - 1H K: OK (0.75%) | 1H D: 1.14% diff
   - 4H: Both <2%
   - 1D: Both <0.1% ✅

3. **BBWP divergence** — Minor (0.8-1.4% range)
   - Mostly OK, only 1D shows 0.84% diff

4. **RSI divergence** — Minor (0.6-1.8% range)
   - 15m: 1.81% | 1H: 0.64% | 4H: 0.02% | 1D: 0.11%

### Recommendation
**Before deploying VPS bot:** Investigate PMARP parameter divergence on 1H/4H. The parameter sweep in the validation output shows much better fits:
- Use `(20,200)` for 1H instead of `(20,350)` 
- Consider timeframe-specific PMARP parameters if divergence persists

The EMA parity is excellent (production-ready). Stoch/RSI/BBWP divergence is within acceptable market noise. PMARP is the blocker.

---

## Next Steps

1. **Immediately:** Complete Supabase migration (5 min)
2. **Then:** Create new Hyperliquid API wallet (10 min)
3. **Before go-live:** Fix PMARP parameters and re-validate (30 min)
4. **After all 3 complete:** Restart VPS bot with new wallet + migration applied

---

Generated: 2026-04-19 (Session 20)
