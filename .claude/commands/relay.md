---
description: Relay session state to next session -- structured handoff without commit/push ceremony
---

Structured handoff for multi-session tasks. Use when you want the next session to pick up exactly where you left off, but don't need to commit, push, or update docs.

Heavier than `/save` (which is a fire exit), lighter than `/wrap` (which commits and updates docs).

## Step 1 -- Quick state check (~2 tool calls)

Run in parallel:
- `git status -sb` -- uncommitted changes + branch info
- `git diff --stat` -- what files changed

## Step 2 -- Write emergency-snapshot.md

Overwrite `emergency-snapshot.md` in repo root with structured relay info.

Use what you already know from conversation context -- do NOT read extra files.

```markdown
# Emergency Snapshot -- Session <N>
Date: <today>

## What was done this session
<Bullet list: what was accomplished, what was attempted, key decisions>

## What was tried and didn't work
<Approaches attempted that failed, with brief reason why. Critical for avoiding loops.>

## Uncommitted work
<List of modified/new files from git status, or "none">

## Key context
<Technical details that would be lost: root causes found, library versions, file locations, formulas, gotchas>

## Next steps when resuming (ordered)
<Numbered list: what to do next, in priority order. Be specific -- include file names, function names, exact steps.>
```

## Step 3 -- Persist knowledge (triage: shared vs personal)

Check whether this session produced knowledge worth persisting beyond the snapshot:

**Shared knowledge** (project-wide facts, decisions, gotchas):
- Propose adding to `CLAUDE.md` (if concise, always-relevant) or `.claude/reference.md` (if detailed, on-demand)
- These go in git-committed files so BOTH users see them

**Personal knowledge** (workflow preferences, user-specific norms):
- Save to auto-memory at `C:\Users\mathe\.claude\projects\c--work-TradeKit\memory\`
- These stay local -- your colleague won't see them (and shouldn't need to)

**Ask if unsure:** "This seems like a project fact -- should I add it to CLAUDE.md so your colleague sees it too?"

Check `MEMORY.md` index: keep under 200 lines. Do NOT duplicate what's already in CLAUDE.md.

## Step 4 -- Confirm to user

```
Relay saved:
- emergency-snapshot.md: <one-line summary>
- MEMORY.md: <updated / no changes>
- Dirty files: <list or "none">
- Next session starts at: <first next-step item>
```

## Rules

- Maximum ~5 tool calls (2 git + write snapshot + optionally edit memory + confirm)
- Do NOT commit, push, or update handoff.md -- that's `/wrap`'s job
- Do NOT read handoff.md or other files -- use conversation context only
- If emergency-snapshot.md already exists, overwrite it (newer = better)
- The "tried and didn't work" section is CRITICAL -- it prevents the next session from going in circles
- `/start` already consumes emergency-snapshot.md -- no need for a separate `/resume`
