---
name: wrap
description: >
  Wrap a TradingBot session — check source files for changes, verify
  test scripts pass, update handoff.md, flag untested code paths and
  real-money risks. Safe to call anytime, idempotent. Use when user
  says "wrap", "wrap session", "wrap up", or "end of session".
---

# Wrap — TradingBot Session

Check the current state of work and wrap up anything that needs it. Safe
to call anytime. If nothing needs doing, say so and stop.

## Project context

- **Project root:** `C:\Users\cryptomeda\Desktop\Swarm\myprojects\TradingBot`
- **Single project**, no subrepos
- **Not a git repo** — track changes via file timestamps + handoff.md
- **Real money on Hyperliquid mainnet** — never auto-execute trades
- **Critical files:** `.env` (never read or commit), `src/`, `package.json`,
  `BTC_TRADING_STRATEGY_KB.md`, `handoff.md`
- **Sister project:** `C:\Users\cryptomeda\Desktop\Swarm\myprojects\tradingview-mcp`
  (cloned MCP server for TradingView CDP integration)

## Step 1 — Assess current state

Run in parallel:
- `ls -la C:\Users\cryptomeda\Desktop\Swarm\myprojects\TradingBot\src\` (recurse)
- Check if `handoff.md` exists at project root
- Check if `BTC_TRADING_STRATEGY_KB.md` is unchanged from baseline
- List recently modified files in `src/` (last 24h via stat)

Read:
- `handoff.md` if it exists — is the current session documented?
- `package.json` — check dependencies match what was discussed

## Step 2 — Report status

Present a brief status check:

```
## Wrap Check

### Source files modified this session
| Path | Last modified | Notes |
|------|---------------|-------|
| src/hyperliquid/orders.ts | <time> | order execution |
| src/tradingview/reader.ts | <time> | MCP indicator reader |
| ... | ... | ... |

### Test scripts available
| Script | Status |
|--------|--------|
| src/scripts/test_connection.ts | <tested? last result> |
| src/scripts/test_dry_run.ts | <tested? last result> |
| src/scripts/test_micro_trade.ts | <tested? last result> |
| src/scripts/test_stop_loss.ts | <tested? last result> |

### Untested code paths (RISK)
<List any code paths that haven't been validated end-to-end>

### Hyperliquid account state (last known)
- Balance: $<X>
- Open positions: <count>
- Open orders: <count>

### Handoff status
<up to date / needs session N section / does not exist>
```

## Step 3 — Take action

### If handoff.md needs update or doesn't exist
Invoke `/doc-update` skill, OR write a fresh `handoff.md` directly with
the structure in Step 4 below.

### If untested code paths exist
List them clearly. Do NOT recommend running them unattended — ask the
user first. Real money is on the line.

### If TradingView MCP or DRY_RUN bot is still running
Note it in the report. Don't kill it — that's the user's call.

## Step 4 — handoff.md structure

If creating fresh, use this template:

```markdown
# TradingBot — Session Handoff

> Single source of truth for resuming work across chat sessions.

## Current State

- **Bankroll:** $<X> on Hyperliquid mainnet (Perps)
- **Master wallet:** 0x... (MetaMask)
- **API wallet:** 0x... (Hyperliquid agent — trade-only, no withdraw)
- **Network:** mainnet
- **Mode:** DRY_RUN / LIVE / IDLE
- **Strategy:** BTC perps, 3 strategies (S1/S2/S3) on multi-TF
- **Last session:** <N> — <date> — <title>

## Architecture

```
TradingView Desktop (BTCUSDC chart, 9 indicators)
        ↓ (CDP port 9222)
tradingview-mcp (Node child process)
        ↓ (stdio MCP)
Trading Bot (src/main.ts)
        ↓
Hyperliquid SDK → Hyperliquid API
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | Main loop, DRY_RUN gate |
| `src/mcp/client.ts` | MCP child-process wrapper |
| `src/tradingview/reader.ts` | Multi-TF indicator snapshots |
| `src/hyperliquid/client.ts` | SDK init, BTC index resolution |
| `src/hyperliquid/account.ts` | balance, positions, funding |
| `src/hyperliquid/orders.ts` | market/limit/stop/cancel |
| `src/strategy/s1_ema_trend.ts` | 4H EMA cross |
| `src/strategy/s2_mean_reversion.ts` | 1H EMA55 retest |
| `src/strategy/s3_stoch_rsi.ts` | 15m Stoch RSI scalp |
| `src/strategy/confluence.ts` | confluence + macro filter |
| `src/risk/manager.ts` | drawdown limits, pause logic |
| `src/risk/sizing.ts` | position sizing |
| `BTC_TRADING_STRATEGY_KB.md` | strategy KB (source of truth) |
| `.env` | secrets — NEVER read or commit |
| `launch_tradingview.ps1` | TV with --remote-debugging-port=9222 |

## Test Scripts

| Script | Purpose | Last status |
|--------|---------|-------------|
| `test_connection.ts` | Hyperliquid read-only smoke test | <pass/fail/date> |
| `test_dry_run.ts` | One-shot full pipeline (no orders) | <pass/fail/date> |
| `test_micro_trade.ts` | $20 long entry+close (real money) | <pass/fail/date> |
| `test_stop_loss.ts` | $20 long + stop + cancel + close | <pass/fail/date> |
| `discover_tradingview.ts` | One-time MCP API discovery | done |

## What Was Done (Session N) — <title>

1. <bullet>
2. <bullet>

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | <task> | low/med/high | <notes> |

## Untested Code Paths

| Code | Why untested | Risk if broken |
|------|--------------|----------------|
| `placeMarketOrder` short | symmetric to long | wrong direction → instant loss |
| `placeLimitOrder` GTC | needs S2 signal | order may not fill |

## Risk Configuration

- Max concurrent positions: 3
- Max exposure: 60% of bankroll
- Daily drawdown limit: 10% → 24h pause
- Weekly drawdown limit: 15% → 48h pause
- Consecutive loss limit: 3 → 4h pause

## Resuming in a new chat

Type `/start` to load this handoff and get a fresh briefing.
```

## Rules

- Never read `.env` — only check that it exists
- Never auto-execute trades or modify `.env`
- Ask before writing/overwriting `handoff.md`
- Keep handoff entries scannable, not verbose
- Flag untested code paths every session until tested
- If TradingView is running and a bot is running, note it but don't touch
- Idempotent — can be called multiple times safely
