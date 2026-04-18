---
description: Update project documentation (handoff.md + conditional strategy KB / frontend analysis / CLAUDE.md) based on this session's work
---

Check whether documentation needs updating based on this session's work, then update only what's actually missing or stale.

## Step 1 -- Smart assessment (minimize reads)

Before reading any files, think about what actually changed this session:
- Did we do ANY work? -> always check `handoff.md`
- Did strategy logic, parameters, or thresholds change (S1/S2/S3 entry/exit rules, leverage, sizing, risk caps)? -> need to check `BTC_TRADING_STRATEGY_KB.md`
- Did we change anything in `frontend/`? -> need to check `FRONTEND_ANALYSIS.md` (if still maintained)
- Did phase status change (e.g., DRY_RUN->LIVE, Phase 0->1, VPS deployed)? -> need to check `CLAUDE.md` if it exists

Only read files that might need updating. Skip the rest.

Then report a brief assessment:

```
Documentation check:
- handoff.md: <status>
- BTC_TRADING_STRATEGY_KB.md: <status or "skipped -- no strategy changes">
- FRONTEND_ANALYSIS.md: <status or "skipped -- no frontend changes">
- CLAUDE.md: <status or "skipped -- no state change" or "not present">

Reference docs in the repo (not stale-checked here):
- analysis-and-recommendations.md (strategic review, date-stamped)
- vps-deployment-research-response.md (if present)
- src/docs/IMPLEMENTATION_PLAN.md, NEXT_PHASE_CONTEXT.md, SESSION_19_SUMMARY.md, handoff.md (session 19 VPS planning artifacts)

Proceed with updates? (N files need changes)
```

If everything is already up to date, say so clearly and stop.

Note: `NEXT_PHASE_CONTEXT.md` is consumable -- it should be deleted once the VPS deployment work (Phase 1+) has started consuming it. If you notice Phase 1 work has begun and the file still exists, flag it.

## Step 2 -- Update only what needs it

### handoff.md (always check)

Add a new session section BEFORE "What To Do Next":

```
## What Was Done (Session N) -- <short title>

1. **<What was built or changed>** -- <concise description>. Files: <list>. Committed: <hash>.
```

Then update:
- "What To Do Next" table to reflect current priorities
- "Key Files" table if new files were added
- "Background Processes" section if bot state changed (LIVE/DRY_RUN/stopped, needs restart, etc.)
- "Untested Code Paths" section -- retire paths validated this session, add new untested paths introduced

**Trimming:** Keep only the last ~3 sessions in handoff.md. Move older sessions to `docs/session-archive.md`. This keeps handoff.md readable and `/start` fast. See trimming convention at the top of handoff.md.

### BTC_TRADING_STRATEGY_KB.md (only if strategy logic/parameters changed)

- Update strategy rules, entry/exit conditions, leverage table, sizing formula, confluence scoring
- Bump the KB version at the top if substantive changes
- Keep this in sync with `src/strategy/*.ts` -- TS is the runtime source of truth, KB is the human reference

### FRONTEND_ANALYSIS.md (only if frontend changed this session)

- Update the relevant page's section (Dashboard / Trades / Strategies / Automation / Market Data / Backtests)
- Update Supabase schema section if migrations were applied
- Update tech-stack notes if dependencies changed (Next version, shadcn components, auth flow)
- If the doc has diverged significantly from `frontend/` reality, flag it rather than attempting a full rewrite in /doc-update

### CLAUDE.md (rarely -- only for state changes, and only if file exists)

- Update Current State / Phase if phase status changed (e.g., DRY_RUN->LIVE, Phase 0 done, VPS deployed)
- Update session number
- Keep concise -- if it's growing past ~200 lines, move detail into handoff or a dedicated reference doc
- If CLAUDE.md doesn't exist yet, skip silently (TradeKit may or may not have one)

## Style rules

- No emojis
- Tables for structured data
- Concise summaries in handoff -- don't paste code; link by file path + line number when specificity matters
- If nothing needs updating, say so and stop
