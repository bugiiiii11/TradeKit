---
description: Save a project fact or personal preference to the right place -- shared (CLAUDE.md) or personal (auto-memory)
---

Quick-save knowledge mid-session without waiting for `/wrap`.

The user provides the insight as an argument: `/brain <insight>`

## Triage

Classify the insight:

**Shared** (project-wide fact, decision, gotcha, convention):
- Append to `CLAUDE.md` in the appropriate section (Current State, Conventions, etc.)
- If CLAUDE.md is near 200 lines, append to `.claude/reference.md` instead
- If `.claude/reference.md` doesn't exist yet, create it with a header

**Personal** (user preference, workflow norm, role context):
- Save to auto-memory at `C:\Users\mathe\.claude\projects\c--work-TradeKit\memory\`
- Create a new memory file with proper frontmatter (name, description, type)
- Update MEMORY.md index

**Ambiguous:**
- Ask: "Should I save this to CLAUDE.md (shared with your colleague) or personal memory (just for you)?"

## Rules

- Maximum 2 tool calls: classify + write
- Do NOT read files to decide -- use the insight text itself
- If the insight is already captured in a recent commit message or handoff entry, skip it (say "already captured in <location>")
- Keep CLAUDE.md under 200 lines, MEMORY.md index under 200 lines
