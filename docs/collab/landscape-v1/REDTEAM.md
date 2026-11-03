# REDTEAM — seat R (non-voting), Landscape Campaign v1

Scope read: `src/`, `deploy/`, `package.json`, `tsconfig.json` only. No scripts run, no API, no SSH. Numbers
not derived from code or an explicit arithmetic line are marked `[assumed]`. All `file:line` references are to
the working tree as of this read.

---

## 1. Assessment

The most likely way the next quarter is spent on something that does not pay is **porting the trend engine
(S6 first, then S1) to a second asset**: BBWP is a percentile of the asset's own recent band width
(`calculator.ts:153-161`), so S6 "finds" compressions and breakouts on every coin at the same rate; the backtest
engine cannot tell a real edge from the best-of-N draw (nothing in `backtest_oos.ts` or the engine corrects for
how many assets were tried); the 30-trade OOS gate (`backtest_oos.ts:236`) silently pushes selection toward the
noisiest, thinnest alts because they produce more signals; and the live path then meets fixed-percent stops,
a 5 % IOC slippage cap and a kill switch that only closes BTC. Every piece of that is already in the code and
every piece reads as "working" until real money hits a thin book. The candidate class the code is best placed to
test cheaply is **S5 graded as a signal, not as a trade**: the webhook, the strategy, and the persisted
`[Webhook] Cascade received` rows already exist, so a forward-return event study (signal time → BTC 1h/4h/8h
return) costs zero trading code and no VPS access — it only needs the rows written since the log line was
fixed (`server.ts:212-216`). Second cheapest is "S1 alone": one env var and doing nothing, which is also the
only configuration whose failure modes are all already catalogued below.

---

## 2. Attack findings (ranked by likelihood × cost)

### F1 — Higher-TF bars are read one 15m slot early with a provisional close (class 1, 9)
`src/ws/candle-consumer.ts:214-236` and `src/backtest/aggregator.ts:389`
```
// New bar opened — previous bar is closed
this.buffer.push({ timestamp: candle.timestamp, open: candle.open, ..., close: candle.close, ... });
...
this.computeAndEmit();
```
```
if (i === sortedKeys.length - 1 && bucket.length < expectedBars) continue;
```
**Trigger.** When the 15m bar that opens at xx:45 arrives, the consumer pushes it (first tick only) and
aggregates. The 1H bucket now holds 4 bars, the 4H bucket at 03:45/07:45/… holds 16, the 1D bucket at 23:45
holds 96 — all pass the "complete" test and are emitted with the *first tick* of the last 15m bar as their close.
The bot therefore sees each 1H/4H/1D bar 15 minutes before it closes, with a wrong close. S1 (`main-headless.ts:275`)
and S6 (`:303`) are wall-clock gated (≥4h / ≥1h since last eval), so each will periodically evaluate exactly on
one of these provisional bars, set `prev4H`/`prevBbwp` from it, and act on a cross that the final close may not
confirm. The backtest never does this (`aligner.ts:58-72`, `findLastClosed`, requires `timestamp + interval <=
decisionMs`). **Blast radius.** Live trades the backtest cannot produce, at full size, on every strategy that reads
1H/4H/1D; and any live-vs-backtest comparison (the only evidence base the project has) is contaminated. Cost is
unquantifiable from code; frequency is roughly 1-in-4 S6 evals and 1-in-16 S1 evals `[assumed uniform drift]`.
**Gate.** In `computeAndEmit`, aggregate `this.buffer.slice(0, -1)` (exclude the just-opened bar) and gate S1/S6
on the higher-TF bar timestamp changing, not on wall-clock elapsed. Pass = the `[S6-diag]` log timestamps never
land on :45 and the live `prevBbwp` matches the backtest's bar value.

### F2 — Two naked-position windows: entry without stop and exit without stop (class 1, 2)
`src/main-headless.ts:398-403` (entry) and `:815-819` (exit)
```
txSig = await placeMarketOrder(confluence.direction, sizing.positionBase, tradeLeverage);
...
stopOid = await setStopLoss(confluence.direction, stopPrice, sizing.positionBase);
```
```
for (const oid of oidsToCancel) { try { await cancelOrder(oid); } catch { } }
await closePosition(pos.direction, true);
```
**Trigger (entry).** Market fill succeeds, `setStopLoss` throws (API hiccup, rounding reject, 429). The
exception unwinds to `:639`; `activePositions.push` (`:424`) and `recordTradeOpen` (`:440`) never run. The exchange
holds a 10x position with no stop; the bot's gate (`:339`, `activePositions.length > 0`) and the risk manager
(`manager.ts:228`, `state.openPositions`) both read zero; on the next signal a second order is placed on top. Only
a restart (hydration) ever notices. **Trigger (exit).** Stop is cancelled first, then `closePosition` throws (IOC
"could not immediately match" in a fast tape) — the position stays open with no stop until the next 15m bar
retries. **Blast radius.** Isolated margin caps each leg at its margin (`orders.ts:68`, `isCross: false`): $5 at
$100, $50 at $1 000 per leg, doubled by the stacked entry. For a 9-trade-a-year S1 one such event is ~11 % of the
year's sample and two months of expected edge at break-even. Discord `#errors` does get "Bar evaluation error",
so this is loud, but the *state* stays wrong until someone restarts. **Gate.** On `setStopLoss` failure: retry
once, then `closePosition` and log; register the position *before* placing the stop so reconcile sees it. On exit:
place the reduce-only close first, cancel the stop after (or let `cancelOpenBtcStops` do it).

### F3 — S1's wall-clock gate makes live entries up to 3h45m later than the backtest's (class 2, 9)
`src/main-headless.ts:275-279` vs `src/backtest/engine.ts:375`
```
if (ENABLED_STRATEGIES.includes("S1") && now - lastS1EvalTime >= 4 * 60 * 60 * 1000) {
  const s1 = evaluateS1(snap4H, snap1D);
```
```
const s1Signal = evaluateS1(snap4H, snap1D);   // every aligned 15m bar
```
**Trigger.** `lastS1EvalTime` is set to the wall clock of whichever 15m bar close first satisfies "≥4h since
last", so evals drift at a 4h15m cadence from process start, unaligned to 4H bucket boundaries. A 4H cross confirmed
at 04:00 is acted on at the next eval, anywhere from 04:00 to 07:45, at that bar's `snap15m.close`. The backtest
acts within 15 minutes. Every 16th eval the cadence skips a whole 4H bar; a cross-and-uncross inside the skipped
bar is invisible. **Blast radius.** With ~9 trades a year, each late entry at 10x on a trend-cross strategy
whose edge is the first hours of the move `[assumed]` is a large fraction of the year's PnL; the OOS backtest
numbers for S1 are not the live bot's numbers. **Gate.** Gate on `snap4H.timestamp !== lastS1BarTs`. Pass = every
`[S1-diag]` line in `bot_logs` is timestamped within 15 min of a 4H boundary.

### F4 — At $100 the sizing floor, not the fee, is what breaks a break-even signal; and the trailing A/B does not describe the live trail (class 1)
`src/main-headless.ts:70, 312, 366-367, 471-474` and `src/hyperliquid/orders.ts:30-33`
```
let LEVERAGE_MULT = parseFloat(process.env.LEVERAGE_MULT ?? "0.25");
const tradeLeverage = Math.max(1, Math.round(rawLeverage * LEVERAGE_MULT));
const s6Leverage = Math.max(1, Math.round(8 * LEVERAGE_MULT));
```
Arithmetic (code defaults, bankroll = `withdrawable` per `account.ts:566-569`):
- S1 leverage = round(10 × 0.25) = 3 → notional = 100 × 0.05 × 3 = **$15**; S6 = round(8 × 0.25) = 2 → **$10.00**.
- Size is floored to 1e-5 BTC (`roundSize`). At BTC $100 000 `[assumed]`: 10/100000 = 0.00010 → $10.00. At $105 000
  `[assumed]`: 0.0000952 → 0.00009 → $9.45, below Hyperliquid's $10 minimum order value `[assumed]` → rejected.
  Any loss that drops `withdrawable` below $100 pushes S6 under the floor at every price.
- Fee share of risk (engine constant `TAKER_FEE = 0.00045`, `engine.ts:42`): S6 at 8x → risk 0.05×8×0.02 = 0.8 %
  of bankroll, fees 0.05×8×0.0009 = 0.036 % → **4.5 % of risk**; S1 at 10x → 1.5 % vs 0.045 % → **3 % of risk**.
  Fees do not turn break-even into losing at either $100 or $1 000; the lot floor and the trail do.
- Trailing: `TRAILING_DISTANCE` default 0.02 equals `S6_STOP_DISTANCE` 0.02 (`s6_bbwp_breakout.ts:139`). On the
  first 15m close above entry, `trailing.ts:153-157` moves the stop to close×0.98 > entry×0.98, and ratchets on
  every new 15m-close high; any 2 % retrace from any close exits. S6's designed exit (`shouldExitS6`, BBWP>85
  then <35) will rarely be reached first `[assumed; measurable]`.
- Live trails on `snap15m.close` (`main-headless.ts:243`); the backtest trails on `bar15m.high/low`
  (`engine.ts:322`) and then checks the SL against the same bar (`engine.ts:113`). `backtest_trailing.ts` therefore
  models a tighter, earlier-exiting trail than the live one — its A/B verdict does not transfer.
- `set_leverage` is in-memory only (`main-headless.ts:980-983`): a pm2 restart reverts to the env default without
  a log line. If the VPS runs at 1.0x `[assumed]`, a restart quarters notional until someone notices.
**Blast radius.** At $100: S6 may never trade at all; S1 trades $15 notional where a single 0.00001-BTC rounding
is 7 % of the position. At $1 000: sizing is fine ($500 / $400 notional) but the 2 % trail on a 2 % stop
converts S6 into a 2 %-stop scalper that no backtest has modelled correctly. **Gate.** Hard-fail an entry whose
rounded notional is under $10; measure live S6 exit-reason mix (`trades.exit_reason` vs `[Trailing]` lines)
before keeping `TRAILING_MODE=trailing` for S6.

### F5 — A perps grid on any asset: nothing to run it, places nothing at $100, and holds unstopped inventory after the third recenter (class 6)
`src/backtest/grid-engine.ts:26, 202-204, 225-244`; `src/strategy/s4_grid.ts` (helpers only)
```
const MIN_NOTIONAL = 10;
...
const notional = margin * grid.leverage;
if (notional < MIN_NOTIONAL) continue;
```
Arithmetic: 100 × 0.01 × 3 = **$3 < $10** → every buy is skipped at a $100 bankroll; at $1 000 it is $30 per cell
and up to 10 cells = $300 = 30 % of bankroll long at 3x.
**Trigger (range break).** Price leaves the grid; after `recenterBarsThreshold` = 5 bars (75 min) all filled
cells are dumped at market (`closeAllCells(..., "recenter_close")`), realising the full inventory loss, and the grid
is rebuilt around the new price — on a trending day this repeats up to `recenterDailyCap` = 3 times, each time
buying the new top. After the cap, `dailyPaused = true` → sell-only, inventory held with **no stop at all** until
UTC midnight. The engine is long-only (`buildCells`, `shortFundingPaid: 0`) so a range-bound alt that breaks
down is the exact scenario that pays nothing and loses everything. **What the code lacks.** There is no grid
executor: `s4_grid.ts` is config and math; `orders.ts` manages one IOC, one GTC limit, one stop; there is no
multi-order book state, no fill tracking, no maker-fee path, and `hydrateActivePositions` matches exactly one
position per direction. The fill model (`high >= topPrice`) assumes a touch is a fill while charging taker fee
(`feePct: 0.00045`) — optimistic on fills, pessimistic on fees, wrong on both for a resting-limit grid.
**Blast radius.** Time: a quarter to build an executor the engine has not justified (`backtest_grid.ts:645` gate
is "net PnL > 0 and 20 round-trips", no holdout). Money: 30 % of bankroll at 3x with no stop on the day the range
breaks. **Gate.** Do not build until the grid backtest shows positive PnL *with* `--no-regime --no-vol-adaptive`
on a window that includes a ≥20 % drawdown of the chosen asset `[assumed threshold]`.

### F6 — S5 cascade shorts: chasing a 15-minute-old event with a signal that is overwritten, not deduplicated, blocked by S1, and not measurable from before the log fix (class 5)
`src/strategy/s5_cascade.ts:40-42, 52-67`; `src/main-headless.ts:552-561, 885-891`; `src/webhook/server.ts:212-223`
```
export function receiveCascadeSignal(signal: CascadeSignal): void { pendingSignal = signal; }
```
```
if (S5_ENABLED && activePositions.length === 0) { ... const s5Signal = evaluateS5();
```
```
const status = hb.lastAt > 0 && (Date.now() - hb.lastAt) > 2 * 3_600_000 ? "⚠️" : "✓";
```
**Trigger.** (a) The sender POSTs when it already sees imminent liquidations; TradeKit enters at the *next* 15m
bar close, 0-15 min later, at `snap15m.close`, after the move the sender measured. (b) Any later POST overwrites
`pendingSignal` and refreshes `receivedAt` — a sender that re-sends the same cascade every few minutes keeps the
signal alive past its 30-min TTL and, after the 8h max-hold exit, re-enters on the same event. (c) `activePositions
.length === 0` means S5 is dead whenever S1 holds (days at a time) — the capacity is "cascades that happen while
flat". (d) The heartbeat counter increments on *any* accepted POST including `medium` (`server.ts:223`), so the
digest's "N heartbeats" is a signal count, not liveness; a sender that never connected since restart reads "✓".
(e) Stop is 4 % at `round(8×LEVERAGE_MULT)`: risk per trade = 0.05×2×0.04 = 0.4 % of bankroll at the code
default, 1.6 % at 1.0x — a fine size, but a cascade's first 15m candle on BTC routinely exceeds 4 % `[assumed]`
and the backtest engine fills stops at the exact stop price (`engine.ts:113-114`, `SLIPPAGE_BPS = 0`), so no backtest
of S5 can show the real stop cost. (f) The sender's fields (`aggregateDebtUsd`, `imminentCount`) describe DeFi
lending debt on EVM chains, not BTC perp order flow; the only persisted record of them is the one console line,
full-precision only since the S53 fix — so any threshold is fit on weeks of data (class 9 trap).
**Blast radius.** Money is small per trade; time is the cost — grading requires a measurement the project has not
run, and every "improvement" to thresholds is a fit on the same weeks. **Gate.** Before any trade: event study of
every `[Webhook] Cascade received` row vs BTC forward return at +15m/+1h/+4h/+8h; require the +15m return (the
latency) to be smaller than the +8h return across ≥30 events `[assumed count]`.

### F7 — The trend engine on ETH/SOL/HYPE: eight BTC-bound seams, fixed-percent stops, 5 % IOC cap, a BTC-only kill switch, and no correction for best-of-N selection (class 3, 9)
`src/hyperliquid/client.ts:733-737`, `orders.ts:27, 63-73`, `account.ts:580, 637`, `ws/candle-consumer.ts:177`,
`backtest/collector.ts:200`, `backtest/binance-loader.ts:88`, `main-headless.ts:116, 339`, `commands/handlers.ts:93-97`
```
const btcIdx = meta.universe.findIndex((u) => u.name === "BTC");
```
```
let lastSetLeverage: number | null = null;   // one cached leverage for the whole process
```
```
.filter((p) => p.position.coin === "BTC")     // getOpenPositions — kill switch closes only these
```
**What assumes BTC.** Single asset index and szDecimals in the context singleton; a single `lastSetLeverage`
cache (a second coin at a different leverage silently reuses the stale value → `ensureLeverage` skipped); every
account read filters `coin === "BTC"` (positions, fills, trigger orders); the WS subscription, REST collector and
CSV loader are string-literal BTC; `syncPositions` keys on `${coin}_${direction}` (fine) but `insertClosedTrade`
hard-codes `symbol: "BTC"` (`main-headless.ts:743`); the entry gate is "any open position" (`:339`), so two coins
serialise onto one slot and `MAX_OPEN_POSITIONS = 3` never engages. **What breaks live.** `S6_STOP_DISTANCE =
0.02` and `S1_STOP_DISTANCE = 0.03` are not volatility-scaled — on an asset with 2-3× BTC's hourly range
`[assumed]` the 2 % stop is inside noise and the trail (F4) exits on the first candle; `MARKET_SLIPPAGE_BPS = 500`
lets an IOC walk 5 % through a thin book and fill there; per-asset max leverage on Hyperliquid is lower for alts
`[assumed]`, and `updateLeverage` with 8x/10x may be rejected. **What breaks selection.** BBWP is self-normalised
(percentile of own history), so S6 produces similar signal counts on every coin; picking "the asset where S6
backtests best" is max-of-N on noise with no code to penalise N; the OOS verdict needs 30 test trades, which the
noisiest alt reaches first. **Blast radius.** Two to three weeks to thread a coin parameter through eight files
plus hydration, plus a kill switch that reports `ok: true, closedPositions: []` while the alt position stays open.
**Gate.** Parameterise coin in the context and account layer first; require the alt's OOS PF to beat BTC's on the
*same* window *after* dividing the candidate count into the significance `[assumed method]`; no live trade until
the kill switch closes a non-BTC position in a test.

### F8 — Funding-rate capture: two legs the code has no concept of, and a backtest that uses the wrong venue's funding (class 4, 9)
`src/hyperliquid/account.ts:566-569, 595-603`; `src/backtest/engine.ts:301-307`; `src/backtest/funding-loader.ts`
```
return parseFloat(state.withdrawable);            // perps clearinghouse only — no spot balance anywhere
```
```
const rate8h = getFundingRateAt(config.fundingRates, bar15m.timestamp);   // Binance 8h rate
hourlyRate = rate8h / 8;
```
Arithmetic at $500, one-to-one hedge (so ~$250 per leg) `[assumed HL base funding 0.01 %/8h; HL spot taker 0.07 %]`:
carry = 250 × 0.0001 × 3 = **$0.075/day ≈ $27/yr**; open+close = 2 perp legs × 250 × 0.00045 + 2 spot legs ×
250 × 0.0007 = 0.225 + 0.35 = **$0.58 ≈ 7.7 days of carry per rebalance**. The base rate pays ~5 % a year on
capital; the only edge is funding spikes, which (a) the live code cannot act on — it has no spot client, no hedged
pair, no maker order path except S2's single GTC (`orders.ts:129-170`), no concept of two positions summing to
zero delta (the gate at `main-headless.ts:339` would block the second leg) — and (b) the backtest cannot see,
because the only funding history loader is Binance 8h CSV (`funding-loader.ts`) applied to a Hyperliquid
strategy, while the live reader returns Hyperliquid's *hourly* rate (`account.ts:596-597`). There is no Hyperliquid
funding-history collector at all (`collector.ts` fetches candles only). **Blast radius.** Time: spot client,
pair accounting, rebalancing logic, hydration for two legs — the largest build on the list, for a ~5 %/yr base
return that any backtest will overstate by using the wrong venue's rates. Counterparty: both legs on one venue
the project has already left once elsewhere `[assumed from brief]`. **Gate.** Do not build until a one-page
measurement of HL hourly funding over the last 12 months (fetched, not Binance) shows the spike-capture
opportunity net of 7.7 days of carry per rebalance exceeds the S1+S6 expectancy.

### F9 — Backtest-driven selection: the scripts that pick winners are in-sample by construction, the OOS gate is unreachable for S1, and stops always fill at the stop (class 9)
`src/scripts/backtest_s6_lookback.ts:330-332`; `src/scripts/backtest_oos.ts:148-149, 236`; `src/backtest/engine.ts:43, 113-114, 499`
```
const winner = sA.pnlUsd >= sB.pnlUsd ? "10" : "40";
console.log(`  → Update s6_bbwp_breakout.ts and fix the stale comment.\n`);
```
```
t.trades < 30 ? `INSUFFICIENT (${t.trades} trades, need 30+)`
```
```
const SLIPPAGE_BPS = 0;
if (direction === "long" && bar15m.low <= stopPrice) return { exit: true, exitPrice: stopPrice, ... };
```
**Trap per class.** *S1 alone:* ~9 trades/yr can never reach the 30-trade OOS verdict, so S1 is unfalsifiable by
the project's own gate and will be kept or dropped on narrative. *S6 / multi-asset:* `setS6Lookback` winner-by-PnL
on the full window, `--timeframe 4H|1H` and `--leverage` as free flags in `backtest_s6.ts` ("Try --timeframe 1H
for more signals", `:357`), and `--train-until/--test-from` as CLI flags — split-date shopping is one rerun away.
*S5 and grid:* exact-stop fills with zero slippage flatter exactly the strategies whose losses are gap-driven;
the grid gate (`backtest_grid.ts:645`) has no holdout at all. *Funding:* wrong venue (F8). *Every class:* the engine
sizes S6 at a hard-coded 8x (`engine.ts:499`) and S1 at 10x while the live default is `round(8×0.25)=2x` /
`round(10×0.25)=3x`, so no backtest PnL is the live PnL even when the signals match. **Blast radius.** The
whole quarter, if any build decision cites a number from these scripts without a pre-registered split date and a
slippage assumption. **Gate.** Freeze `--train-until` in a committed config before any new strategy is swept; add
`SLIPPAGE_BPS ≥ 5` `[assumed]` as the default; report trade counts next to every PF.

### F10 — A second venue: the venue-specific semantics are spread across five files, and the only external watchdog watches one string from one feed (class 8, 10)
`src/hyperliquid/orders.ts:24, 41-53, 409-423, 462-466`; `account.ts:566-569, 661`; `ws/candle-consumer.ts:170`;
`client.ts:726-729`; `deploy/deadman-check.cjs:446-447`
```
const MARKET_SLIPPAGE_BPS = 500;   // Hyperliquid has no native market order — IOC limit at ±5 %
```
```
isStopLoss: o.orderType.startsWith("Stop"),     // frontendOpenOrders — HL-only field
```
```
.eq("source", "ws").like("message", "[WS] Bar closed%")
```
**What is venue-specific.** IOC-as-market, 5-significant-figure price rounding, `tpsl` trigger orders, oid
reassignment on `batchModify`, `withdrawable` as bankroll, `frontendOpenOrders.orderType` for SL/TP hydration,
the SDK's candle/subscription types, and the agent-wallet model (`privateKeyToAccount` + master address) that lets
a trade-only key exist at all — a second venue needs its own permission model, and the one-venue incident
precedent in the brief says the project has already paid for that lesson once. **What breaks operationally.** One
process, one `activePositions` gate, one trade log file, one dead-man string: a second venue's loop can die with
no alert because `[WS] Bar closed` from Hyperliquid keeps flowing (see §4). For a strategy set that trades ~9+N
times a year, doubling venues doubles key rotation, .env copies and hydration paths for zero extra signal.
**Blast radius.** Time (an abstraction layer over five files) and operational risk; no edge. **Gate.** Only if the
reason is venue risk, not return — and then the first deliverable is a dead-man per venue, not an order path.

---

## 3. Tried and could not break

- `aligner.ts:58-72` `findLastClosed`: `timestamp + intervalMs <= bar15m.timestamp + 15m` is correct; the
  lookahead is gone in the backtest. (The live-side provisional bar in F1 is a different bug.)
- `aggregator.ts:389` drops an incomplete last bucket correctly whenever the buffer's last 15m bar is not the
  final slot of the bucket — the F1 case is the only hole.
- Risk gate arithmetic (`manager.ts:207-277`): daily/weekly DD, consecutive-loss pause-and-reset, exposure cap
  are consistent; the only softness is that `recordTradeResult` PnL excludes fees and funding
  (`main-headless.ts:734-738`), which understates drawdown slightly — not enough to flip a pause decision.
- `modifyStopLoss` (`orders.ts:472-526`): new-oid capture via `batchModify` plus one re-discovery retry — sound.
- Command bus (`db/commands.ts`): claim-then-execute, generation-aware `CLOSED` handling, capped backoff — sound.
- Reconnect path (`candle-consumer.ts:324-381`): every network await is `withTimeout`-wrapped, including
  error-path dispose; the 3-minute watchdog exits the process. Could not construct a silent hang from the code.
- Webhook (`webhook/server.ts`): bearer check, 64 KB body cap, loopback default, severity whitelist — the auth
  surface is fine; the problems are semantic (F6).
- Fee constant `TAKER_FEE = 0.00045` and hourly funding accrual in the engine match the lowest Hyperliquid tier
  `[assumed]`; fees alone do not sink any candidate at $100 or $1 000 (F4 arithmetic).
- Hydration SL/TP classification by order type (`account.ts:661`) — correct; the stale-record issue in §4 is
  upstream of it.
- "Could not find a reason this would not pay, given the code": **S1 alone at $1 000 with `TRAILING_MODE=off`.**
  Every failure I found for S1 is latency (F3), state (F2) or evidence (F9), not expectancy; the code gives me no
  way to say its break-even is really negative. The cost of keeping it alive is the VPS and the watchdog, both of
  which already exist.
- Passive channels (class 7): nothing in the repository touches a vault, copy-trading or points — there is no
  code to break. What the pitch leaves out is not code-derivable: see §5.

---

## 4. Silent-failure list (class 10)

Each of these produces **no error line and no alert** given the current consumer and dead-man pattern.

1. **A second coin's bars mask the BTC loop dying.** `deadman-check.cjs:446-447` is satisfied by *any*
   `[WS] Bar closed` row with `source = "ws"`; `logs.ts:57-59` derives source from the `[WS]` prefix. A second
   `CandleConsumer` logging the same prefix keeps the dead-man green while the BTC subscription is dead — and vice
   versa.
2. **Shared-transport heartbeat.** `candle-consumer.ts:197-199` resets `lastMessageTime` on any message. Two
   subscriptions on one transport: coin B's stream stops, coin A's keeps the heartbeat alive, no reconnect, no log.
3. **S5 sender dead since restart reads "✓".** `main-headless.ts:888` only flags staleness when `lastAt > 0`; a
   sender that never connected shows `(last: never) ✓` in the status channel, and nothing ever goes to `#errors`
   for a silent sender. `S5_ENABLED && !secret` warns once at startup only (`:991-993`).
4. **Every Discord alert can vanish.** `discord.ts:399-401` returns silently on any non-OK, non-429 status or any
   fetch throw; a revoked or rate-limited webhook kills `#errors` too, with no log line. The dead-man's own
   Discord failure (`deadman-check.cjs:431-434`) goes only to `deadman.log`.
5. **Natively-stopped trades never close in `trade_log.json`.** `reconcilePositions` (`main-headless.ts:696-768`)
   writes `insertClosedTrade` but never `logTradeClose` (only `checkExits:827` does). Open records accumulate;
   `hydrateActivePositions:141-145` uses `find`, which returns the *oldest* record matching direction and ±0.5 %
   price — after enough SL exits, a restart can attach the wrong strategy and a months-old `entryTimestamp` to the
   live position (for S5 that means an immediate `s5_max_hold` exit), with no warning.
6. **Kill switch closes only BTC.** `handlers.ts:93-97` iterates `getOpenPositions()`, which filters
   `coin === "BTC"` (`account.ts:580`). Any non-BTC position (second asset, or a web-UI trade on another coin)
   survives the kill switch, and the command row is written `done` with `closedPositions: []`.
7. **Leverage multiplier reverts on restart.** `set_leverage` mutates an in-memory `let` (`main-headless.ts:70,
   980-983`); pm2 restarts to the env default with only the normal startup banner — notional silently changes by
   up to 4× with no "reverted" line.
8. **Trade-log write races.** `trade_logger.ts:277-287` read-modify-writes a JSON file synchronously; a second
   consumer or venue in the same process writing concurrently is fine, but a second *process* sharing the file
   corrupts it with no error until the next `JSON.parse` throws at hydration.

---

## 5. Questions only a measurement or the owner can answer

1. What is `LEVERAGE_MULT` in the VPS `.env` right now? (Decides whether S6 can place any order at $100 — F4.)
2. How many `[S6-diag]` / `[S1-diag]` rows in `bot_logs` are timestamped at :45 (or 03:45/07:45/…)? (F1 frequency.)
3. Of live S6 exits in `trades`, how many are `native_sl` after a `[Trailing]` move vs `bbwp_cycle_complete`? (F4.)
4. Does S1 ever reach 30 trades in any OOS test window the data supports? If not, what gate replaces it? (F9.)
5. For every `[Webhook] Cascade received` row since the S53 log fix: BTC return at +15m, +1h, +4h, +8h. (F6.)
6. Hyperliquid's current minimum order value and BTC lot size — the $10 and 1e-5 BTC figures here are assumed. (F4.)
7. Per-asset max leverage and szDecimals for the alts a seat proposes; does `updateLeverage(8)` succeed there? (F7.)
8. Twelve months of Hyperliquid *hourly* funding (not Binance 8h): how much of the annual carry is spike days? (F8.)
9. How many `exit_price: null` records sit in the VPS `trades/trade_log.json` today? (§4-5 hydration risk.)
10. When F2's naked window opens at 03:00 UTC, who can reach the VPS shell and how long does it take? (Owner.)
11. Passive channels (class 7): what is the vault's worst peak-to-trough drawdown, its withdrawal lock-up, and its
    capacity at $1 000 — and is any of that visible before depositing? (Owner; nothing in code answers it.)
12. Which of the ten classes has a seat already written code for outside this repo? (Sunk cost is the strongest
    predictor of what gets built next; the owner knows, the code does not.)
