---
description: Pin key context before compact -- preserve what compression loses
---

Capture reasoning, insights, and technical details that /compact would compress away.
Use BEFORE running /compact. After compact, read the pinned file to restore context.

Flow: `/pin` -> `/compact` -> "read context-pin.md"

## What to write

Write `context-pin.md` in the repo root with:

```markdown
# Context Pin -- Session <N>
Date: <today>

## Key insights (reasoning compact would lose)
<Counter-intuitive findings, "why" behind decisions, analysis conclusions>
<These are things that can't be re-derived just by reading files>

## Active reasoning thread
<What you're currently thinking about, mid-task logic, approach being pursued>
<Include specific file:line references, function names, exact values>

## Rejected approaches (and why)
<What was considered and ruled out, with brief reason>
<Prevents re-exploring dead ends after compact>

## Important numbers / comparisons
<Specific metrics, thresholds, table data that would be summarized away>
```

## Tagging for persistence

When writing pins, tag insights that should survive beyond this session:

- `[SHARED]` = project-wide fact. `/wrap` should route this to CLAUDE.md or .claude/reference.md
- `[PERSONAL]` = workflow preference. `/wrap` should route this to auto-memory
- Untagged = temporary context for surviving compact only (consumed, not persisted)

Example:
- `[SHARED] Hyperliquid candleSnapshot has a hard 5000-candle retention ceiling -- not paginatable`
- `[PERSONAL] User prefers seeing strategy breakdown tables in backtest output`
- `S3 BBWP filter at 40 reduced trades from 102 to 46` (untagged -- this is already in the code and commit)

## Rules

- `/wrap` should scan `context-pin.md` (if it still exists at wrap time) for `[SHARED]` and `[PERSONAL]` tags and route them to the correct destination
- Maximum 1 tool call: write the file
- Do NOT read any files -- use what you know from conversation
- Do NOT commit, push, or update other docs
- If context-pin.md already exists, overwrite it (newer = better)
- This is INTRA-session only (complement to /compact). For inter-session handoff, use /relay or /save.
- Keep it short: 10-20 bullets max. If you need more, you should /relay instead.

## Pin quality checklist

A good pin preserves what compact loses. Focus on:
- **"Why" behind decisions** -- not just what was done, but reasoning that can't be re-derived from files
- **Rejected approaches with reasons** -- prevents re-exploring dead ends (highest value per line)
- **Exact numbers** -- thresholds, metrics, comparisons that compact rounds or drops
- **Counter-intuitive findings** -- things that surprised you or contradict assumptions
- **Active thread state** -- if mid-task, what you were about to do next and why

Skip:
- Outcomes already in commit messages or handoff (compact preserves these)
- File paths and code structure (can be re-read)
- Action items / pending tasks (compact preserves these)

Empirical preservation rate: ~85-90% of critical context survives pin+compact.

## After writing

Tell the user:
```
Pin saved to context-pin.md.
Run /compact now. After compact, say "read context-pin.md" to restore context.
```

**Post-compact auto-restore (best-effort):**
After the user runs /compact and sends their next message, if `context-pin.md` exists in the repo root, read it BEFORE doing anything else. This restores the pinned context without requiring the user to remember. After reading, delete the file (it's been consumed).

**Known limitation:** Auto-restore depends on the model following CLAUDE.md instructions after compaction. There is no post-compact hook to force this. If the model misses it, the user can say "read context-pin.md" as a reliable fallback. This is a text-instruction mechanism, not a structural guarantee.
