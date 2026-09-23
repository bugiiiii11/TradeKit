# BTC Trading Bot — Analysis and Recommendations

**Companion to:** `BTC_TRADING_STRATEGY_KB.md` v1.0 (2026-04-09)
**Analysis date:** 2026-04-11
**Reviewer:** Claude (Opus 4.6) via Flash project research session

---

## Executive summary

The original strategy doc is well-organized and the architectural instinct (mechanical execution of TA strategies on a perp DEX with AI-mediated risk management) is sound. However, the current version has three issues that need to be addressed before any code is written:

1. **Drift Protocol was hacked for ~$285M on April 1, 2026.** The protocol is frozen in incident response. The chosen venue is operationally invalid this month. Replace with Hyperliquid (recommended) or another viable perp DEX.
2. **The strategies (Krown's S1/S2/S3) have no verifiable track record.** Krown Trading is a teachable.com course business, not an audited fund. Win rate claims like "85% (n=13)" are marketing copy. The strategies may still be valid starting points but should be backtested rigorously before any execution code is written.
3. **The TradingView MCP integration adds risk and complexity without adding alpha.** It's technically real but ToS-grey, brittle, and provides no signal that can't be computed directly from exchange OHLCV data. Drop it from the profit version, keep it only if the goal is a demo-for-Krown pitch.

The most important decision is **which version of this project you're building**: a profit-seeking trading bot, or a demo to pitch a partnership with Krown. They look superficially similar but have almost no engineering overlap. This document covers both paths.

---

## 1. Critical blocker — Drift Protocol hacked April 1, 2026

### What happened

On April 1, 2026, attackers drained between $270M and $285M from Drift Protocol. The largest DeFi exploit of 2026 and the second-largest in Solana's history (after the 2022 Wormhole bridge hack at $326M).

The exploit was not a code bug. It used a legitimate Solana feature called **durable nonces** combined with a 6-month social engineering campaign:

- The attackers spent months posing as a quantitative trading firm to build trust with Drift contributors
- Beginning Fall 2025, they cultivated relationships with Drift Security Council members
- On March 23, 2026, four durable nonce accounts were created — two associated with legitimate Council members, two controlled by the attacker
- On April 1, approximately one minute after a legitimate test withdrawal, the attacker submitted pre-signed durable nonce transactions
- Two transactions, four Solana slots apart, were enough to create, approve, and execute a malicious admin transfer
- The exploit was attributed by multiple firms (Chainalysis, TRM Labs, Elliptic) to a North Korean state-affiliated group

### Current status (as of 2026-04-11)

- All deposits into Drift's borrow-and-lend products, vault deposits, and trading funds are affected
- The protocol has been frozen
- The compromised wallet has been removed from the multisig
- The Solana Foundation announced a security overhaul on April 7 in response to the incident
- No timeline has been published for restoring user deposits or reopening trading

### Implication for the original architecture

The original doc's choice of Drift was reasonable in early April 2026 — Drift was a healthy Solana perp DEX with the right combination of leverage, fees, and decentralization. As of this week, that choice is invalidated. Building against Drift now would mean either:

1. Funding a wallet on a frozen protocol (not currently possible)
2. Building against testnet and waiting for the protocol to restore (timeline unknown, possibly weeks to months)
3. Rebuilding when the situation resolves (effort wasted if the post-incident architecture differs)

**Recommendation:** Choose a different venue. See section 5.1.

---

## 2. Strategy evidence is weaker than the original doc implies

### What's actually verifiable about Krown

I researched Krown's trading credentials and found no independent verification of any of the win-rate or risk-reward claims in the original doc.

- **Krown Trading is a teachable.com course business.** Primary product: "Trade Like a Professional — The Art and Application of Technical Analysis," a paid course.
- **No published equity curve.** No third-party tracked account, no audited P&L, no public verifiable performance documentation.
- **The "85% win rate (11/13 since 2023)" stat for S1 is from Krown's own marketing.** n=13 is a sample size where any TA strategy can look heroic — it's well within the range of pure noise.
- **The "avg win 1.8%, avg loss 0.55%" for S2 also has no source.**

### Why this matters

This doesn't mean the strategies are bad. EMA crosses, RSI mean reversion, and Stochastic RSI scalping are standard public TA patterns. The relevant questions are:

1. Do they have positive expectancy after fees on out-of-sample data?
2. Does that expectancy survive the bot's actual execution latency and slippage?
3. Is the expectancy large enough to compound a $500-2,000 bankroll meaningfully?

The original doc treats these as already answered. They aren't. Independent academic studies of EMA cross strategies typically find them break-even or marginally negative on liquid assets after realistic costs.

### The telling detail

Krown himself is currently building a bot but hasn't been able to connect it to TradingView. Take this seriously: if Krown's strategies obviously printed money, he'd be running them with millions of dollars in capital, not selling courses and tweeting about an unfinished bot. The most parsimonious explanation is that Krown's business is content + education, with personal trading as a secondary activity, and the strategies are heuristics that work in some market regimes and not others.

### What to do about it

**For the profit version:** backtest before building. Pine Script makes this almost free. Run all three strategies on 2019-2024 BTC data with realistic fees (~0.05% per trade) and slippage (~0.05%). Three possible outcomes:

1. Positive expectancy survives → use them
2. Roughly break-even → the system works as a learning tool but won't compound a small bankroll
3. Negative expectancy → kill the strategies, use one of the alternatives in section 5.4

**For the demo version:** strategy validity doesn't matter — you're using Krown's framework precisely *because* it's his.

---

## 3. TradingView MCP — real, but not an edge

### The repo exists and works as described

The original doc references `tradesdontlie/tradingview-mcp`. I verified:

- The repository is real and active on GitHub
- It uses Chrome DevTools Protocol (CDP) to connect to a locally running TradingView Desktop instance
- It does not reverse engineer any TradingView server protocol — it operates entirely locally
- Multiple forks and community implementations exist
- The architecture in the doc accurately describes how the project works

So the technical claim — "this exists and you can connect Claude to TradingView Desktop via MCP" — is correct.

### TradingView ToS exposure

TradingView's Terms of Use restrict automated, non-display use of their data and platform:

> "Prohibited uses include automated trading, automated order generation, price referencing, algorithmic decision-making, algorithmic trading, or any machine-driven processes that do not involve direct, human-readable display of data."

The MCP repo author acknowledges this and explicitly puts compliance responsibility on the user. This is an account-ban risk if TradingView decides to enforce, and they have enforced before. For a production trading bot you'd be operating in a grey zone that could vanish at any time.

### Why webhook alerts are the standard for retail bots

The conventional path for connecting TradingView to a trading bot is:

1. Pine Script computes the signal on the chart
2. TradingView fires an alert when the condition is true (paid plan feature, ~$15/mo for Pro+)
3. The alert hits your bot's HTTP endpoint with a JSON payload
4. The bot executes

This is:
- **Explicitly within ToS** — webhook alerts are an official TradingView feature
- **Reliable** — doesn't break when TV ships UI updates
- **Server-friendly** — doesn't require running TV Desktop, can run on a VPS
- **Battle-tested** — used by thousands of retail bots

The CDP-MCP approach gives you nothing webhooks can't, *unless* what you specifically need is "an LLM that can read the live state of the chart in natural language at any moment, not just on alert fire." For a profit-focused bot, you don't need that. For a demo-focused project, that's the entire value proposition.

### The narrow case where CDP-MCP is the right tool

If your goal is to build something where an LLM agent watches a chart in real time, reasons about it in natural language, and explains its decisions in plain English to a human user — then CDP-MCP is the right choice and webhook alerts can't replace it. This is the demo-version use case.

For execution-only bots that just need to know "did the EMA cross fire?", webhook alerts are strictly better.

### What to do about it

- **Profit version:** drop TradingView entirely. Compute indicators in TypeScript from exchange OHLCV. See section 5.3.
- **Demo version:** keep CDP-MCP. It is the entire point.

---

## 4. The fork — profit version vs demo-for-Krown version

This is the most important decision in the project, and the original doc doesn't address it because it implicitly assumes profit is the goal. After discussion, an alternative framing has emerged: build a working TradingView-MCP-connected bot as a proof of concept, then use it to pitch a partnership with Krown directly.

These are different projects.

### Side-by-side comparison

| Dimension | Profit version | Demo-for-Krown version |
|---|---|---|
| Goal | Generate trading P&L | Get Krown's attention, possible partnership |
| Real capital | Yes, $1.5k-2k recommended | No (testnet or paper) |
| Venue | Hyperliquid (or alternative) | Hyperliquid testnet, or in-process paper |
| TradingView MCP | DROP (adds risk, no alpha) | KEEP (it IS the point) |
| Strategy backtest rigor | Critical before building | Doesn't matter (using Krown's as-is) |
| Strategy choice | Whatever has positive expectancy OOS | Krown's S1/S2/S3 (his framework) |
| Execution reliability | Critical | Nice to have |
| Demo polish | Not required | Critical |
| Time to live/demo | 4-8 weeks | 1-2 weeks |
| Worst case | Lost capital from running an unproven system | Krown ghosts, you have a portfolio piece |
| Best case | Compounding bankroll | Partnership, audience leverage, content collab |

### Why you can't do both at once

The two versions share maybe 20% of the engineering. They optimize for different things:

- A profit bot optimizes for **execution reliability, fee minimization, slippage control, and statistical signal.** It runs headless on a VPS, uses direct exchange feeds, and has zero UI.
- A demo bot optimizes for **narrative clarity, demo polish, and the impressiveness of one specific feature** (the LLM-on-chart reasoning loop). It runs locally with TV Desktop visible, uses CDP-MCP, and centers on a 90-second screen recording or live walkthrough.

If you try to build both into one system you'll get a brittle hybrid that's worse at each goal than a focused build.

### How to choose

Three questions:

1. **Whose budget is the $500 (or $1.5k+)?** If it's Flash project capital, the profit version competes with the Tier 0 #3 deployment ($1k grid+Steakhouse) which is the highest-ROI item on the Flash roadmap. If it's separate personal exploration budget, both versions are open.
2. **Do you actually have a path to Krown?** Cold pitches to creators have ~10-20% reply rate even when the work is great. If you have a warm intro or are already in his community, the demo version's expected value rises sharply. If not, plan for the realistic 80% case where he never replies.
3. **Are you optimizing for a result you can measure in a month, or a result that requires 3-6 months of running?** The demo version produces a deliverable in 1-2 weeks. The profit version doesn't have meaningful signal until 100+ trades have run, which is 1-3 months.

**Default recommendation if you're not sure: build the demo version first.** It's cheaper, faster, and the worst case (Krown ghosts) leaves you with a working portfolio piece you can pivot from. The profit version's worst case is "we built a bot, ran it for 3 months, and learned the strategies don't have alpha" — a much more expensive lesson.

---

## 5. Layer-by-layer swap recommendations

These apply to the profit version unless noted. For the demo version, see section 7.

### 5.1 Venue — Drift → Hyperliquid

**Recommended: Hyperliquid (HyperCore L1)**

Reasons:
- **Own L1 chain** with sub-second finality
- **FIFO order book at the chain level** — no sandwich/frontrun risk
- **~$4-5B perp TVL**, deep BTC orderbook
- **Fees: 0.025% taker, -0.015% maker rebate** — slightly better than Drift's pre-hack fees
- **50x leverage on BTC perps** — more than enough for the doc's 3-10x range
- **No security incidents** — clean track record since launch
- **Active TypeScript and Python SDKs** with maintained official tooling
- **Operational know-how transfers from Flash project** — `liq-morpho-hype` runs on HyperEVM (Hyperliquid's EVM sister chain), so existing RPC notes, fallback patterns, and chunk-size tuning apply

Alternatives ranked:

| Option | Pros | Cons |
|---|---|---|
| **Jupiter Perps (Solana)** | Stays on Solana ecosystem, 100x leverage, no recent issues | Pool-based (you trade against JLP), smaller depth than Hyperliquid, oracle pricing |
| **GMX V2 (Arbitrum)** | Mature, oracle-priced, well-tested, ~$500M open interest | Pool-based borrow rates instead of funding, different mental model |
| **dYdX v4 (Cosmos appchain)** | Order book, FIFO, 20x BTC, mature exchange | Ecosystem more isolated, smaller liquidity than Hyperliquid |
| **Aevo (Optimism)** | Options + perps, mature | Less perp liquidity, more relevant for options strategies |

Skip: Drift (until post-hack situation resolves), centralized exchanges (defeats DeFi premise), GMX V1 (deprecated).

### 5.2 Chain — downstream of venue

The "Solana" choice in the original doc was downstream of "Drift" — it wasn't an independent decision. Once you swap the venue, the chain follows.

If you go Hyperliquid → you're on HyperCore (Hyperliquid's own L1, JSON-RPC API, simpler than EVM gas accounting).

The only reason to actively prefer Solana would be if you have existing wallet infrastructure, ecosystem opportunities, or a personal preference that's load-bearing. If none of those apply, leaving Solana costs you nothing.

### 5.3 Signal source — TradingView MCP → direct OHLCV (profit version)

**Profit version recommendation: drop TradingView entirely.**

Stack:
- Read OHLCV from the exchange's WebSocket feed (Hyperliquid has a clean WS API)
- Compute indicators in TypeScript using `technicalindicators` or `tulind`
- Every indicator in the original doc is one library call: EMA, RSI, Stochastic RSI, Bollinger Bands
- BBWP and PMARP are slightly more custom (~30 lines each) — they're percentile transforms over rolling windows of standard indicators
- Strategy logic reads precomputed indicator state and emits orders

This eliminates: TradingView ToS risk, CDP brittleness, the dependency on TV Desktop running, the dependency on the TV UI not changing, and a class of "the chart said X but the bot saw Y" bugs. It runs headless on a VPS like the rest of the bots.

**Middle ground if the friend wants to keep TV in the loop:** Use Pine Script alerts → webhook. Pine Script computes the signal on the chart, fires an alert, the alert hits the bot's HTTP endpoint with a JSON payload. ToS-compliant, simple, reliable, ~$15/mo for TradingView Pro+. This is the standard retail bot integration.

**Demo version: keep CDP-MCP.** See section 7.

### 5.4 Strategy framework — Krown → backtest first OR keep as-is

**Profit version:** Treat Krown's strategies as starting hypotheses to test, not edges to mechanize. Run all three through Pine Script's strategy tester on 2019-2024 BTC data with:
- Realistic fees (~0.05% per trade)
- Realistic slippage (~0.05% on market orders)
- Multiple timeframe configurations
- An out-of-sample holdout period

Decision tree:

| Result | Action |
|---|---|
| Positive expectancy survives OOS | Use them, build the bot |
| Roughly break-even | The system runs as a learning tool but won't compound a small bankroll. Decide based on whether learning is the goal. |
| Negative expectancy | Kill the strategies, switch to a fallback (below) |

**Fallback strategies if Krown's don't survive:**

- **Funding rate arbitrage.** When BTC perp funding is heavily positive (e.g. >0.05% per 8h), short the perp + long spot. Capture funding. Real, persistent, but capital-intensive (need both legs) and competitive at scale. Works at $1-5k.
- **Volatility-regime range trading.** Only trade S2-style mean reversion when daily ATR is in the lower 40th percentile of its 90-day distribution. Filters out trending markets where MR loses badly.
- **Correlated-pair statistical arb.** When the BTC/ETH ratio diverges from its 30-day mean by >2 standard deviations, trade convergence. Crypto majors are highly correlated so this works occasionally.

None of these are alpha printers. They're systems with **honest expected value**.

**Demo version:** Use Krown's strategies as-is. The whole point is "an LLM reasoning in HIS framework." Swapping them defeats the purpose.

### 5.5 Bankroll & leverage — $500 / 10x → $1,500-2,000 / max 5x

The original doc's $500 with up to 10x leverage doesn't have enough margin for the natural variance of TA-style systems.

The math:
- 10% daily drawdown limit on $500 = $50 = 5 stop-outs at 1% risk per trade
- A normal losing streak in a 50-55% win rate system is 4-6 losses in a row roughly once per 50 trades
- That's the daily limit being hit on a normal streak, not a tail event
- 100-200 trades minimum to get statistical signal on whether the system works
- At ~5 trades/week from S1+S2 combined, that's 5-10 months of running

Better setup for the profit version:

- **$1,500-2,000 starting capital** for 3x more headroom
- **Max 5x leverage**, not 10x — the leverage in the original doc is what kills accounts during normal losing streaks
- **Paper trade for 4-6 weeks first** — confirm infrastructure runs cleanly before any real capital
- **Hyperliquid testnet exists** and uses realistic order book mechanics — much better paper environment than in-process simulation

Demo version: $0 capital, paper or testnet only.

---

## 6. Recommended stack — profit version

### Architecture

```
Hyperliquid WebSocket OHLCV feed
           |
           v
Indicator computation layer (TypeScript + technicalindicators lib)
  EMA 8/13/21/55/200, RSI 14, Stoch RSI, BBWP, PMARP
           |
           v
Strategy engine
  S1 (EMA cross), S2 (RSI MR), S3 (Stoch scalp)
  — only after backtest validation
           |
           v
Risk manager (position sizing, leverage cap, drawdown limits)
           |
           v
Hyperliquid order execution (official SDK)
           |
           v
Trade logger (JSON-line to disk + Telegram notifications)
           |
           v
Telegram bot manager (reuse bot-manager-telegram pattern from Flash)
```

### Component list

- **Runtime:** Node 22, TypeScript strict mode
- **Indicators:** `technicalindicators` npm package (or `tulind` if you want C-backed performance)
- **Exchange SDK:** `@hyperliquid/sdk` or community equivalent
- **Process supervision:** pm2 (matches existing Flash bot infra)
- **VPS:** OCI ARM #2 has spare capacity — currently runs 3 Sui bots at ~1GB RAM out of 12GB. Adding a 4th process is trivial.
- **Telegram control:** extend the existing `bot-manager-telegram` to add this bot as a 4th controlled process
- **Backtesting:** Pine Script (free in TradingView free tier) for strategy validation phase

### Time to live

| Period | Activity | Gate |
|---|---|---|
| Week 1 | Backtest S1/S2/S3 in Pine Script | Decision: do strategies survive OOS? |
| Weeks 2-3 | Build the bot (indicators, strategy engine, risk, execution) | Code review |
| Weeks 4-7 | Paper trading on Hyperliquid testnet | Clean infra, expectancy roughly matches backtest |
| Week 8 | Live with $1,500 | If paper period is clean |

Total: 6-8 weeks from kickoff to live capital.

### What to skip from the original doc

- Drift Protocol section (replace with Hyperliquid)
- TradingView MCP server install (drop entirely)
- TradingView Desktop dependency
- Phase 4 future expansions until v1 has 100+ trades of live history

### What to add

- A backtest report file showing the OOS expectancy of each strategy
- A paper-trading log file with the same JSON schema as the live trade log
- Telegram `/backtest` command for ad-hoc strategy validation

---

## 7. Recommended stack — demo-for-Krown version

### Architecture

```
TradingView Desktop (Krown's exact chart, his exact indicator settings)
           |
           v (Chrome DevTools Protocol)
TradingView MCP server (tradesdontlie/tradingview-mcp)
           |
           v
Claude (LLM reasoning engine)
  - Reads chart state in real time
  - Identifies setups using Krown's S1/S2/S3 framework
  - Explains reasoning in plain English in Krown's voice
           |
           v
Demo output layer
  - Live commentary stream (text)
  - Optional: paper trade execution log
  - Optional: 90-second screen recording capture
```

### Component list

- **TradingView Desktop** with `--remote-debugging-port=9222`
- **`tradesdontlie/tradingview-mcp`** server running locally
- **Claude Code or custom LLM client** as the reasoning engine
- **Prompt engineering layer** — the most important component. You need to encode Krown's framework, language patterns, and decision criteria into the system prompt with enough fidelity that the LLM's commentary sounds authentically like Krown teaching the setup.
- **Optional:** simple paper-trading state tracker for "what would have happened"
- **Optional:** screen recording tooling (OBS, ffmpeg, ScreenStudio) for the deliverable

### The demo deliverable

The thing you actually send to Krown is a **90-second screen recording** showing:

1. A live BTC chart with Krown's exact indicator setup (8/13/21/55/200 EMAs, RSI, Stoch RSI, BBWP, PMARP)
2. The LLM watches the chart and provides running commentary in real time
3. As an S1 (or S2) setup forms, the LLM identifies it and explains the reasoning in Krown's exact framework language: "we're seeing the 8 cross above the 55, the 13 and 21 are already above, price is above the 200 daily EMA — this is a textbook S1 long signal, I'd enter at..."
4. The LLM articulates entry, stop-loss placement, and exit criteria the way Krown teaches them in his course

The pitch when you send it: **"We built an LLM co-pilot that runs your trading framework. It watches the chart and explains every decision in your voice. Want to see it run on your own setup?"**

NOT: "We connected to TradingView" (Krown's coder already did that via webhooks). NOT: "We automated your strategies" (anyone can do that).

### Time to demo

| Days | Activity |
|---|---|
| 1-2 | Get `tradesdontlie/tradingview-mcp` working locally with TV Desktop. Confirm CDP integration is stable. |
| 3-5 | Build the prompt engineering layer. Iterate on getting the LLM to sound like Krown reading his own setups. |
| 6-8 | Build the live commentary loop. Test on historical chart playback first, then live. |
| 9-12 | Polish the demo flow. Record 5-10 takes of the 90-second video. Pick the best. |
| 13-14 | Outreach to Krown. |

Total: 1-2 weeks from kickoff to first outreach.

### What to focus engineering on

- **Prompt quality.** This is 60% of the project. The LLM's voice has to feel like Krown's voice. Watch his actual videos, transcribe his exact phrasing for each setup type, encode it in the prompt.
- **Chart state extraction reliability.** The CDP layer needs to consistently read the current values of all indicators across all relevant timeframes. Brittleness here breaks the demo.
- **Latency.** The commentary needs to feel real-time, not laggy. Keep the LLM call cadence to once per 2-5 seconds.

What NOT to spend time on for the demo: real execution, real risk management, real capital, performance measurement, multi-strategy interactions.

---

## 8. The Krown-partnership angle — honest read

### What would actually impress Krown

A working LLM-on-chart demo that uses HIS framework, in HIS language, on HIS chart, and explains decisions the way HE teaches them in his courses. The value isn't the engineering — it's the demonstration that an LLM can embody his teaching framework as a usable tool.

This maps directly onto his revenue model. He sells courses teaching his framework. An AI that *embodies* the framework is a natural extension of his course product. Co-branding makes immediate sense: "the AI co-pilot for the Krown Trading framework, available with the course."

### What wouldn't impress him

- "We connected your bot to TradingView." His coder either has done this already or knows how (Pine Script + webhooks).
- "We automated your strategies." Any retail trader can do this.
- "We built a profitable trading bot using your strategies." Even if it works, it's not unique to him and he has no reason to partner.
- A GitHub repo or technical README. He won't run your code.

### Cold-pitch reality

Cold outreach to creators has a 10-20% reply rate even when the work is genuinely good. Plan for the 80% case where Krown never responds. Your fallback should be:

- **Portfolio piece.** A working LLM + financial UI integration on the friend's GitHub, useful for fintech/AI tooling job applications.
- **Product seed.** The same architecture works for ANY TA-driven trader with a published framework. Krown is the obvious first target. Other candidates: Crypto Banter, Benjamin Cowen, ChartGuys, Inner Circle Trader. The product becomes "configurable LLM co-pilot for TA traders, with [framework] as the demo configuration."
- **Open source release.** Publishing the project compounds credibility regardless of whether any specific creator responds.

### The reframe that strengthens the project

Don't pitch "we built Krown's bot." Pitch **"we built the LLM co-pilot framework for TA traders, and we built the Krown configuration first."** This has three advantages:

1. It survives Krown ghosting (you have a real product, not a one-shot pitch)
2. It positions you as a builder with a thesis, not a fan asking for attention
3. It opens the door to multiple traders, not just one

### Important reality check

Before any code is written: **find the exact YouTube clip where Krown talks about his bot and the TradingView connection problem.** ~30 minutes of searching. Verify what he actually said vs. what was remembered. Specifically:

- Did he say "I wish someone would solve this for me" (real pain point, green light)
- Or did he say "yeah, the TV part is taking my coder some time" (filler banter, you're projecting a need that may not exist)

If the latter, the demo's pitch needs to be reframed around general TA-trader value, not Krown specifically.

---

## 9. Decision points before any code is written

These need answers before kickoff. Most are not technical.

| Question | Why it matters | Default if you don't decide |
|---|---|---|
| Profit version, demo version, or both phased? | Different engineering, different timelines, different success criteria | Demo version first |
| Whose budget is the capital? Flash project or personal? | Flash maturity-phase priorities take precedence over speculative builds | Personal budget |
| What did Krown actually say? | Determines whether the demo pitch has a real hook | Find the clip before building |
| Do you have a path to Krown? Warm intro, community, cold? | Affects expected reply rate and the polish needed on the demo | Assume cold, plan for 80% no-response |
| What's the demo medium? Recording, sandbox, repo? | Determines what gets engineered | 90-second screen recording |
| Are S1/S2/S3 backtested OOS? | Determines whether the profit version is even viable | Backtest in week 1 of profit version |
| Time horizon for "is this working"? | Profit needs 1-3 months minimum, demo needs 1-2 weeks | Demo for fast feedback |

---

## 10. Concrete next steps

In recommended order. Each step is ~1 day to ~1 week.

### Phase 0 — Decide and validate (1 week, no code)

1. **Pick the version.** Profit, demo, or phased. Default: demo first.
2. **Find the Krown clip.** Verify what he actually said about the bot and the TradingView connection. ~30 min of YouTube searching.
3. **Decide the capital source.** Personal budget vs. Flash budget. If Flash, defer until Tier 0 #3 lands.
4. **(Profit version only)** Backtest S1/S2/S3 in Pine Script on 2019-2024 BTC data. Document expectancy with realistic fees and slippage. **This is the gate** — if all three are negative or break-even after costs, the profit version pivots to a fallback strategy or kills entirely.

### Phase 1A — Demo version build (1-2 weeks)

5. Get `tradesdontlie/tradingview-mcp` working locally with TV Desktop. Confirm CDP integration is stable on your machine.
6. Build the prompt engineering layer. Watch 5+ Krown videos, transcribe his setup-explanation language, encode in the system prompt.
7. Build the live commentary loop. Test on historical playback first.
8. Polish the demo. Record 5-10 takes of the 90-second video. Pick the best.
9. Outreach to Krown. If no response in 2 weeks, pivot to portfolio-piece or other-creator framing.

### Phase 1B — Profit version build (4-6 weeks, ONLY if backtest passes)

5. Set up Hyperliquid testnet account. Verify the SDK works.
6. Build the indicator computation layer in TypeScript.
7. Build the strategy engine (start with the simplest validated strategy — likely S1).
8. Build the risk manager and trade logger.
9. Wire to Hyperliquid testnet. Run for 4-6 weeks of paper trading.
10. If paper trading is clean (no infra surprises, expectancy roughly matches backtest), go live with $1,500.

### Phase 2 — Iterate (ongoing)

11. Weekly trade log review.
12. Monthly strategy parameter audit.
13. Add second strategy only after first has 100+ live trades of evidence.

---

## Sources

### Drift Protocol incident
- [How Drift attackers drained $270M (CoinDesk, 2026-04-02)](https://www.coindesk.com/tech/2026/04/02/how-a-solana-feature-designed-for-convenience-let-an-attacker-drain-usd270-million-from-drift)
- [Drift Protocol Hack: Privileged Access Led to $285M Loss (Chainalysis)](https://www.chainalysis.com/blog/lessons-from-the-drift-hack/)
- [North Korean Hackers Attack Drift Protocol (TRM Labs)](https://www.trmlabs.com/resources/blog/north-korean-hackers-attack-drift-protocol-in-285-million-heist)
- [Drift Protocol exploited for $286M in suspected DPRK attack (Elliptic)](https://www.elliptic.co/blog/drift-protocol-exploited-for-286-million-in-suspected-dprk-linked-attack)
- [Solana Foundation security overhaul (CoinDesk, 2026-04-07)](https://www.coindesk.com/tech/2026/04/07/solana-foundation-unveils-security-overhaul-days-after-usd270-million-drift-exploit)

### TradingView MCP integration
- [tradesdontlie/tradingview-mcp on GitHub](https://github.com/tradesdontlie/tradingview-mcp)
- [TradingView Terms of Service](https://www.tradingview.com/policies/)

### Krown Trading
- [Krown Trading teachable.com](https://krown-trading.teachable.com/)
- [Trade Like a Professional course](https://krown-trading.teachable.com/p/trade-like-a-professional-the-art-and-application-of-technical-analysis)
- [KrownTrading.net](https://www.krowntrading.net/)

### Drift Protocol (pre-hack reference)
- [Drift Trading Fees docs](https://docs.drift.trade/trading/trading-fees)
- [Drift Protocol homepage](https://www.drift.trade/)

### Independent strategy research
- [Quantitative Study of the EMA Cross Trading Strategy (Medium/Superalgos)](https://medium.com/superalgos/quantitative-study-of-the-ema-cross-trading-strategy-29d5ed655a4)

---

*Document prepared 2026-04-11 as a companion to BTC_TRADING_STRATEGY_KB.md v1.0 (2026-04-09). All web research conducted on 2026-04-10 to 2026-04-11. If this analysis is more than ~2 weeks old when you read it, the Drift Protocol situation specifically should be re-checked since incident response is ongoing.*
