# TradeKit VPS Bot — Tasks for Colleague

> Created: 2026-04-18 (Session 21)
> Status: 3 tasks pending

We built the VPS headless bot (runs alongside the desktop bot, separate wallet, shared database). Three things need doing before it can go live:

1. **Supabase migration** — add columns for two-bot source tagging (2 min, SQL Editor)
2. **New Hyperliquid API wallet** — separate wallet for the VPS bot (10 min, MetaMask)
3. **TradingView indicator validation** — verify our local calculations match the chart (10 min, needs TV Desktop)

Details below.

---

## 1. Supabase Migration

Go to the Supabase dashboard → **SQL Editor** and run this:

```sql
ALTER TABLE market_snapshots ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'tv-bot';
ALTER TABLE risk_snapshots ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'tv-bot';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'tv-bot';
ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS target text;
CREATE INDEX IF NOT EXISTS idx_risk_snapshots_source_taken ON risk_snapshots (source, taken_at DESC);
```

All existing rows automatically get `source = 'tv-bot'` (correct — they came from the desktop bot). If you have Claude with Supabase MCP, you can ask Claude to run this for you.

To verify it worked:

```sql
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'risk_snapshots' AND column_name = 'source';
```

Should return one row with `data_type = 'text'`, `column_default = 'tv-bot'`.

---

## 2. New Hyperliquid API Wallet

The VPS bot needs its own wallet so it trades independently from the desktop bot.

**Steps:**
1. Open MetaMask with the master wallet (`0x3a8a...C46`)
2. Go to Hyperliquid → Settings → API Wallets
3. Create a **new agent wallet** (trade-only, **no withdraw** permission)
4. Save the new wallet's **private key** and **address**
5. Fund it with **$500 USDC** from the master wallet

**What to send back:**
- New API wallet address (e.g. `0x...`)
- Private key (send securely — goes in the VPS `.env` file, never committed to git)

---

## 3. TradingView Indicator Validation

We need to verify our locally computed indicators match TradingView's values — especially PMARP which we fixed this session.

**Steps:**
1. Launch TradingView Desktop with CDP enabled:
   ```powershell
   & "C:\Program Files\WindowsApps\TradingView.Desktop_*\TradingView.exe" --remote-debugging-port=9222
   ```
   (Or use `launch_tradingview.ps1` from the repo root)

2. Make sure the BTC/USDC chart has these indicators visible:
   - 5× EMA (periods: 8, 13, 21, 55, 200) — in that order on the chart
   - RSI (14)
   - Stochastic RSI (14/14/3/3)
   - BBWP (period 13, stdDev 1, lookback 252)
   - **PMARP (period 20, lookback 350)** ← check these match on the chart

3. Run the validation script from the repo root:
   ```powershell
   npx ts-node src/scripts/validate_indicators.ts
   ```

**What to send back:**
- The full console output (prints a comparison table with PASS/FAIL per indicator)
- If PMARP shows FAIL, note what PMARP settings are currently on the TradingView chart

---

**Priority:** migration (1) is the quickest and most important. Wallet (2) and TV validation (3) can wait until you have time.
