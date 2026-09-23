---
name: save
description: >
  Emergency context save for TradingBot — dump session state to
  emergency-snapshot.md before context compaction. Use when context is
  running low (80%+) or user says "save", "emergency save", or
  "save context".
---

# Save — Emergency TradingBot Snapshot

Fast emergency save. Use when context is running low and you need to
preserve what happened this session. No ceremony — just dump and stop.

## Project context

- **Project root:** `C:\Users\cryptomeda\Desktop\Swarm\myprojects\TradingBot`
- **Real money on Hyperliquid mainnet** — note current state precisely

## What to write

Run in parallel (max 3 calls before writing):
- `ls -la C:\Users\cryptomeda\Desktop\Swarm\myprojects\TradingBot\src\`
  (to capture file timestamps)
- `netstat -an | findstr 9222` (TradingView CDP status)

Then create `C:\Users\cryptomeda\Desktop\Swarm\myprojects\TradingBot\emergency-snapshot.md`
with this content:

```markdown
# Emergency Snapshot — TradingBot
Date: <today, ISO format>

## What was done this session
<Bullet list — what was built, decided, tested, or discovered>

## Files modified this session
<List from src/ recent modifications, or "none">

## Hyperliquid state (last known)
- Balance: $<X>
- Open positions: <count>
- Open orders: <count>
- Mode: <DRY_RUN / LIVE / IDLE>

## TradingView state
- CDP port 9222: <open / closed>
- Symbol: <if known>
- Timeframe: <if known>

## Background processes that should still be running
- DRY_RUN bot in PowerShell window N: <yes / no>
- TradingView Desktop with debug port: <yes / no>
- launch_tradingview.ps1 PowerShell window: <yes / no>

## Untested code paths
<List code that hasn't been validated end-to-end on real money>

## Key context that would be lost
<Anything important — root causes, decisions, gotchas, security notes>

## Next step when resuming
<What was in progress or about to start>

## Resuming
1. Open new chat
2. Type `/start`
3. Then paste the relevant section of this snapshot if needed
```

## Rules

- Maximum 3 tool calls before writing the file
- Do NOT commit, push, or update other docs
- Do NOT read .env, ever
- Do NOT read handoff.md unless absolutely necessary — use what you know
  from the conversation
- Write fast, move on. This is a fire exit, not a wrap-up.
- If an emergency snapshot already exists, overwrite it (newer is better)
- Note any background processes the user might forget about (DRY_RUN bot,
  TradingView, etc.)
