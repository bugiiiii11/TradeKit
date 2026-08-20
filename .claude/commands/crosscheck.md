<!--
/crosscheck -- old-session review of the NEW session's /start briefing.

Ritual: after /wrap, the user opens the next session, runs /start there, then
pastes that briefing BACK into this (old, context-rich) session with
/crosscheck. This session verifies the handover landed intact and emits a sync
addendum for anything that didn't.

Ported from Swarm (.claude/commands/crosscheck.md, itself from project Or) in
TradeKit S48. Durable-store names adapted to TradeKit's knowledge architecture:
handoff.md / CLAUDE.md / docs/session-archive.md / auto-memory.
-->

Review the pasted /start briefing from the NEXT session against everything this
session still holds in working memory. You are the context-rich side of the
handover; the briefing is what actually made it across. Find the gaps.

## Input

The user's message contains the new session's briefing (usually pasted right
after this command, or in the same message). If no briefing is present, ask for
it and stop.

## What to do (working memory only -- like /brain, NOT /wrap)

**Zero file reads, zero git commands, zero SSH.** Everything you need is in your
context; if you feel the urge to re-read a file or query the VPS to check a
claim, the claim goes into the addendum tagged `[a]` instead.

Compare the briefing against your live knowledge on four axes:

1. **Wrong** -- statements that contradict what you know (stale Watchlist row
   copied forward, a decision reversed late in the session, a number that
   changed: balance, oid, stop price, pm2 restart count, git hash).
2. **Missing** -- load-bearing context that exists in your head or this chat but
   appears nowhere in the briefing AND nowhere durable (handoff.md, CLAUDE.md,
   docs/session-archive.md, auto-memory, a pushed doc). Chat-only artifacts are
   the classic leak: a verbal "leave the bot alone", a forensic timeline, a
   backup file path, an "I'll do X next" promise, a test alert the new session
   will misread as real.
3. **Drifted** -- subtly weakened wording: a Tier-0 watch demoted to Heads Up,
   an "unproven on a real outage" qualifier dropped, a "deliberately disabled"
   strategy re-opened as a question, a validation event detached from the fixes
   it validates.
4. **Perishable** -- anything time-boxed or state-dependent the new session must
   act on before it goes stale: an open position with a static stop, a bot
   running OLD code that needs a restart, a pending VPS deploy, a cron or pm2
   change made by hand that isn't in the repo, a Discord alert that was a test.

## Output format

```
## Crosscheck -- S<old> reviewing S<new> briefing

**Verdict:** fully synced / N points (material) + M nits

<If points exist:>
| # | Axis | Point | Fix |
|---|------|-------|-----|
| 1 | missing | <what + where it lives now> | <one-line action> |

<Then, ONLY if there are material points:>
### Sync addendum for S<new> (paste verbatim into the new session)
<Self-contained prose the user can paste. Written for the NEW session's Claude:
 no "see above", no chat references it can't resolve. Tag every factual claim.
 Keep under ~20 lines.>
```

## Confidence tags (use on every factual claim in the addendum)

- `[v]` VERIFIED -- I read the code, ran the command, saw the log, or queried
  the exchange THIS session.
- `[a]` ASSUMED -- pattern-matched or remembered, plausible but NOT traced this
  session.
- `[i]` INTERPRETED -- the user said X in prose; I'm reading it as Y.

Untagged = the reader assumes verified, which is the failure mode this prevents.

## Rules

- **"Fully synced" is a first-class answer.** Do not manufacture points to seem
  useful; a nit is a nit, label it so. A clean "no points" is explicitly valued.
- Working memory only. Exactly 0 tool calls in the normal case.
- Material point = the new session would act wrongly, touch a LIVE bot it
  shouldn't, or miss a time-boxed action without it. Everything else is a nit
  (one line, no addendum entry).
- The addendum must be paste-ready and self-contained -- the new session has not
  read this conversation.
- If the same point keeps recurring across sessions, say so and suggest where it
  should live durably (Watchlist row, CLAUDE.md convention, Untested Code Paths,
  auto-memory) so the ritual stops carrying it by hand.
- TradeKit nuance: the briefing may legitimately know MORE than this session --
  the bot trades between sessions, and /start is supposed to re-verify VPS
  state. A fresher balance, a closed position, or a higher pm2 restart count in
  the briefing is not a "wrong"; only flag it if it contradicts something this
  session verified on the exchange or the box AFTER that change could have
  happened.
