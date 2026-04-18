---
description: Load a side project's context for cross-project work without polluting main project memory
---

Work on a side project from the current workspace. Loads the side project's context (handoff + CLAUDE.md + memory) as read-only reference, and records all work in the side project's handoff.

The user provides a path argument: the root directory of the side project.
Example: `/side c:\work\Flash` or `/side c:\work\another-project`

## Step 1 -- Locate and read side project context (do all in parallel)

Given the path argument `$PATH`, read these files (skip any that don't exist):

- `$PATH/handoff.md` -- session history, backlog, current state
- `$PATH/CLAUDE.md` -- project instructions and conventions
- Auto-memory file at `~/.claude/projects/<slug>/memory/MEMORY.md` where slug is the path with `\` replaced by `-`, lowercase, drive colon dropped. Example: `c:\work\Flash` -> `c--work-Flash`

Also run:
- `git -C "$PATH" status -sb` -- uncommitted changes in side project
- `git -C "$PATH" log --oneline -3` -- recent commits

## Step 2 -- Present side project briefing

Show:

## Side Project: <name from CLAUDE.md or handoff>

**Path:** `$PATH`
**Git:** <clean/dirty> | <branch>

### Context
<Key info from handoff: status, recent work, backlog>

### Side Project Mode Active
- I will work on files in `$PATH`
- I will only update `$PATH/handoff.md` when done
- I will NOT update this workspace's MEMORY.md with side project details
- Side project's CLAUDE.md conventions apply to work in that directory

**What would you like to work on?**

## Step 3 -- Work on the side project

Follow the side project's CLAUDE.md conventions (commit style, no emojis, etc.) for any work done in that directory.

When the user is done (says "done", "wrap", "back to main", etc.), update the side project's handoff:

1. Read `$PATH/handoff.md`
2. Add a new session entry summarizing what was done
3. Update status/backlog as needed
4. Write the updated handoff back

Do NOT:
- Update any handoff or memory file in the MAIN project workspace (TradeKit)
- Write side project details to this workspace's MEMORY.md
- Run `/wrap` for the main project (that's separate)

## Rules

- Side project context is READ-ONLY except for handoff.md
- Safety hooks from the main workspace still apply (they're process-level)
- If the side project has its own CLAUDE.md, follow its conventions for work in that directory
- If no handoff.md exists at `$PATH`, create one using the standard template
- Keep the briefing short -- the user already knows the project, they just need a refresh
