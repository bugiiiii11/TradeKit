---
description: Session initialization -- read project state, show what's next, flag anything stale or uncommitted
---

Initialize the session by reading project state and presenting a clear starting point.

## Step 1 -- Read project context (do all in parallel)

Read these files:
- `handoff.md` (root) -- recent sessions + Watchlist + "What To Do Next" (~200 lines, read in full)
  - If handoff.md exceeds 500 lines, read only the last 300 lines (to catch recent sessions + Watchlist + What To Do Next). If this happens, also flag "handoff.md at N lines -- consider archiving older sessions to docs/session-archive.md" in Heads Up.

Note: CLAUDE.md is auto-loaded every message -- do NOT read it again.

Run these commands:
- `git status -sb` -- uncommitted changes + branch tracking info
- `git log --oneline -5` -- recent commits for context
- `wc -l "C:/Users/mathe/.claude/projects/c--work-TradeKit/memory/MEMORY.md"` -- check memory index size (system invariant: must stay <200 lines or content gets truncated and silently lost). If the file doesn't exist yet, Claude Code auto-creates it on first memory save -- treat absence as "no memory yet".

Check if emergency snapshot exists:
- `emergency-snapshot.md` (repo root)
- If it exists, read it and include its contents in the briefing under "Emergency Recovery"
- After presenting the briefing, delete the snapshot file (it's been consumed)

Check if context pin exists:
- `context-pin.md` (repo root)
- If it exists, read it and include its contents in the briefing under "Pinned Context (from previous compact)"
- After presenting the briefing, delete the file (it's been consumed)

## Step 2 -- Present session briefing

Show a concise briefing in this exact order. **Watchlist comes BEFORE What To Do Next** -- watches gate everything else and must not be buried.

```
## Session Briefing

**Last session:** <N> -- <title from handoff>
**Git:** <clean/dirty> | <ahead by N commits / up to date>
**Bot status:** <LIVE / DRY_RUN / stopped> (infer from CLAUDE.md "Current State" and handoff Watchlist)

### Watchlist (check before any other work)
<Copy the Watchlist table from handoff.md verbatim. If it's empty or absent, say "Watchlist empty.">
<Flag any watch where the "Since" date is >30 days old as POTENTIALLY STALE.>

### What To Do Next
<Copy the "What To Do Next" table from handoff.md>
<Flag any items that appear already done based on git log or session notes>

### Emergency Recovery (only if snapshot existed)
<Summary of what was in progress from the snapshot>

### Heads Up
<Any uncommitted work, unpushed commits, or stale handoff items>
<If the LIVE bot is stopped/errored per handoff, mention it prominently>
<If handoff says bot needs restart for newer code, flag it at the top of Heads Up>
<If MEMORY.md >180 lines: WARN "MEMORY.md at N lines (limit 200, truncation risk). Trim soon.">
<If MEMORY.md >200 lines: ELEVATE TO TOP of briefing as CRITICAL (cross-session continuity bug -- content already being silently lost).>
<If nothing, say "All clear.">
```

## Rules

- Do NOT make any changes (except deleting consumed emergency snapshot + context pin)
- Keep the briefing short and scannable
- Flag stale items honestly (e.g., "Priority 1 appears already done based on commit f3fc44b")
- If the LIVE bot is stopped, errored, or needs a restart to pick up newer code, mention it prominently
- **Watchlist > What To Do Next > Heads Up** -- this order is non-negotiable. Watches are Tier 0 monitoring; burying them in Heads Up is a known regression to avoid.
