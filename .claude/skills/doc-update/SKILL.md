---
name: doc-update
description: >
  Update TradingBot project documentation (handoff.md, optionally
  CLAUDE.md). Smart assessment first — only updates what actually
  needs updating based on this session's work. Use when user says
  "doc update", "update docs", or invoked by /wrap.
---

# Doc Update — TradingBot

Check whether documentation needs updating based on this session's work,
then update only what's actually missing or stale.

## Project context

- **Project root:** `C:\Users\cryptomeda\Desktop\Swarm\myprojects\TradingBot`
- **Single project**, no subrepos, not a git repo
- **Main doc:** `handoff.md` at project root
- **Strategy KB:** `BTC_TRADING_STRATEGY_KB.md` (rarely changes — only
  update if strategy logic changed)
- **Optional:** `CLAUDE.md` at project root for project-specific
  conventions (only create if user asks)

## Step 1 — Smart assessment (minimize reads)

Before reading any files, think about what actually changed this session:
- Did we do ANY work? → always check `handoff.md`
- Did we change strategy logic in `src/strategy/` or risk caps? → check
  `BTC_TRADING_STRATEGY_KB.md`
- Did we add new test scripts in `src/scripts/`? → must update handoff
  Test Scripts table
- Did we add new untested code paths? → must update handoff Untested
  Code Paths table
- Did Hyperliquid balance change (real trade executed)? → update
  Current State
- Did we change anything in `src/hyperliquid/` or `src/tradingview/`? →
  update Key Files table if new files added

Only read files that might need updating. Skip the rest.

Then report a brief assessment:

```
Documentation check:
- handoff.md: <status — exists/missing, up to date / stale>
- BTC_TRADING_STRATEGY_KB.md: <status or "skipped — no strategy changes">
- CLAUDE.md: <skipped unless user requests>

Proceed with updates? (N files need changes)
```

If everything is already up to date, say so clearly and stop.

## Step 2 — Update what needs it

### handoff.md (always check)

If it doesn't exist, create it from the template in the `/wrap` skill.

If it exists, add a new session section BEFORE "What To Do Next":

```
## What Was Done (Session N) — <short title>

1. **<What was built or changed>** — <concise description>.
   Files: <list>. Tested: <yes/no>.
2. ...
```

Then update:
- "Current State" section if balance, mode, or position state changed
- "What To Do Next" table to reflect current priorities
- "Test Scripts" table if new scripts added
- "Untested Code Paths" table if new paths added or paths now tested
- "Key Files" table if new files added

**Trimming:** If handoff has more than ~5 session sections, move oldest
to bottom under "Archive" or delete if trivial.

### BTC_TRADING_STRATEGY_KB.md (rare — only for strategy changes)

- Update only if strategy parameters, risk caps, or KB-defined logic
  changed
- Bump the "Last updated" date
- Do NOT modify casually — this is the source of truth for the strategy

### CLAUDE.md (only if user explicitly asks)

- Project-specific conventions for Claude Code to follow
- Keep under 80 lines
- Don't create unprompted

## Style rules

- No emojis in docs
- Tables for structured data
- Concise summaries — don't paste code blocks into handoff
- Mark dates as ISO (YYYY-MM-DD)
- Mark times as 24h
- If nothing needs updating, say so and stop
- Never read or modify `.env`
- Always preserve existing handoff content (append/edit, don't rewrite)
