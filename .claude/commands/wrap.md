---
description: Check session state -- commit & push if needed, update docs if stale
---

Check the current state of work and wrap up anything that needs it. Safe to call anytime -- mid-session, after a chunk of work, or at session end. If nothing needs doing, say so and stop.

## Step 1 -- Assess current state (do all in parallel)

Run these commands:
- `git status -sb` -- uncommitted/unstaged changes + branch tracking (ahead/behind remote)
- `git log --oneline -5` -- what's been committed recently?
- `git diff --stat` -- what files have changed (line-level detail)?

Read:
- `handoff.md` -- is the current session documented? Is "What To Do Next" accurate?

## Step 2 -- Report and act

Present a brief status check:

```
## Wrap Check

**Uncommitted changes:** <list files, or "none">
**Unpushed commits:** <count, or "none">
**Handoff status:** <up to date / needs session N section / stale>
**Docs status:** <up to date / needs update>
```

Then handle each issue:

### Code changes (commit & push)
- If there are uncommitted changes, ask: "Want me to commit & push these?"
- Treat commit & push as one action (the user expects both unless they say otherwise)
- If the user says yes, follow the standard git commit protocol, then push
- Do NOT auto-commit -- always ask first

### Documentation updates
- If handoff.md or other docs need updating, invoke `/doc-update` (updates handoff.md, and conditionally BTC_TRADING_STRATEGY_KB.md / FRONTEND_ANALYSIS.md / CLAUDE.md based on what changed)
- If this was a discussion/analysis session (no code), still update "What To Do Next" if priorities changed

### Knowledge triage (shared vs personal)

Before finishing, check: did this session produce knowledge worth persisting?

**Route to CLAUDE.md or .claude/reference.md (shared, git-committed):**
- Project-wide facts (e.g., "Hyperliquid fees are 0.045% not 0.025%")
- Architecture decisions (e.g., "dropped TradingView MCP for VPS version")
- Technical gotchas (e.g., "candleSnapshot has 5000-bar hard cap")
- Convention changes (e.g., "BBWP uses population stdev, not sample")

**Route to auto-memory (personal, local):**
- User preferences ("I prefer concise responses", "don't summarize at end")
- Personal workflow norms ("I use /wrap mid-session when switching topics")
- User role/context ("I'm the frontend person", "I handle the strategy tuning")

**Don't save to both.** If it's in CLAUDE.md, auto-memory doesn't need it.
If unsure, ask: "Should I save this to CLAUDE.md (shared with your colleague) or personal memory (just for you)?"

### "What To Do Next" check
- Compare "What To Do Next" table against what was done this session
- Flag completed items and suggest new ones that emerged
- Ask the user before making changes

## Rules

- Always ask before committing, pushing, or modifying docs
- If everything is clean and up to date, just say "All wrapped. Nothing to do." and stop
- Keep it brief -- don't over-explain
- This skill can be called multiple times safely (idempotent)
