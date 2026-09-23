---
name: start
description: >
  Start a TradingBot session — read handoff.md, verify .env exists,
  check Hyperliquid balance, check if TradingView and DRY_RUN bot are
  running, present a session briefing with What To Do Next. Use when
  user says "start", "start session", or at the beginning of a new chat
  about TradingBot.
---

# Start — TradingBot Session

Initialize a TradingBot session by reading project state and presenting
a clear starting point.

## Project context

- **Project root:** `C:\Users\cryptomeda\Desktop\Swarm\myprojects\TradingBot`
- **Real money on Hyperliquid mainnet** — be cautious
- **TradingView Desktop** must be launched via `launch_tradingview.ps1`
  for any chart-reading work

## Step 1 — Read project context (do all in parallel)

Read:
- `handoff.md` (project root) — session history + What To Do Next
- `BTC_TRADING_STRATEGY_KB.md` only if handoff references something unclear

Check filesystem:
- `.env` exists? (do NOT read its content)
- `node_modules/` exists? (if not, dependencies need installing)
- `src/` modified files in last 24h

Check if running processes (best effort):
- `netstat -an | findstr 9222` — is TradingView CDP port open?
- Skip Hyperliquid balance check unless user asks (avoid unnecessary
  network calls in a briefing — leave it for explicit work)

If `emergency-snapshot.md` exists at project root:
- Read it
- Include its contents in the briefing under "Emergency Recovery"
- After presenting the briefing, delete the snapshot file (consumed)

## Step 2 — Present session briefing

```
## TradingBot — Session Briefing

**Last session:** <N> — <title from handoff>
**Current state:** <DRY_RUN / LIVE / IDLE>
**Bankroll:** $<X> on Hyperliquid mainnet (last known)

### Environment Check
| Item | Status |
|------|--------|
| .env exists | ✅ / ❌ |
| node_modules installed | ✅ / ❌ |
| TradingView CDP (port 9222) | ✅ open / ❌ not running |
| handoff.md | ✅ / ❌ missing |

### What To Do Next
<Copy table from handoff.md "What To Do Next">

### Untested Code Paths
<Copy table from handoff.md if any>

### Emergency Recovery (only if snapshot existed)
<Summary of what was in progress from the snapshot>

### Heads Up
<Anything stale, missing, or risky>
<If nothing, say "All clear — ready to work.">
```

## Step 3 — Recommend first action

Based on the current state, suggest ONE concrete next step:

- If `.env` missing → "Create .env from .env.example before doing anything"
- If `node_modules` missing → "Run `npm install`"
- If TradingView not running → "Launch via launch_tradingview.ps1"
- If DRY_RUN logs need review → "Check the DRY_RUN PowerShell window for new ticks"
- If untested code paths exist → "Test <path> next, see test script <name>"
- Otherwise → first item from "What To Do Next" table

## Rules

- Do NOT make any changes to source files (except deleting consumed
  emergency-snapshot.md)
- Do NOT read .env, ever
- Do NOT call Hyperliquid SDK or place test trades during start
- Keep briefing short and scannable
- Flag stale items honestly
- If handoff.md doesn't exist, say so and recommend invoking `/wrap` to
  create one based on conversation history
