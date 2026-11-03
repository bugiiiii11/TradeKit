# Paste sheet -- Landscape Campaign v1

Open each seat in a **fresh tab in the TradeKit workspace** (`C:\work\TradeKit`), on the model named, and paste
the block. Do nothing else in that tab. When the seat says it is done, tick the box and tell the coordinator
session (this one, S54) the round is done. The coordinator gate-checks and tells you when to paste the next
round. Seat B must run on this PC (it needs the SSH key at `C:/Work/.ssh/`). Expect each Round 1 seat to take
30-90 minutes; Round 2 is shorter.

## Round 1 (two tabs, paste both; the coordinator spawns the red team itself)

- [ ] **Tab A -- Opus 5.5**
```
Round 1. Do not run /start. Read C:\work\TradeKit\docs\collab\landscape-v1\BRIEF_A.md and follow it exactly.
You are the desk-research seat of a landscape pass for the TradeKit trading bot: where is an edge a $100-$1k
participant can capture, on Hyperliquid or elsewhere. Read only what the brief names plus the web (cite URL +
date on every number), write only C:\work\TradeKit\docs\collab\landscape-v1\REVIEW_A.md in the brief's fixed
skeleton. Do not read handoff.md, do not open any other file in docs/collab/, no Supabase, no SSH, no commits.
```

- [ ] **Tab B -- Fable 5.1**
```
Round 1. Do not run /start. Read C:\work\TradeKit\docs\collab\landscape-v1\BRIEF_B.md and follow it exactly.
You are the empirical seat of a landscape pass for the TradeKit trading bot: measure our realised edge, costs,
capacity and the data we already hold. The exchange and the VPS are READ-ONLY for you (no orders, no
bot_commands inserts, no pm2 restart/stop, no .env reads or edits, no deploys). Read only what the brief names,
write only C:\work\TradeKit\docs\collab\landscape-v1\REVIEW_B.md (plus throwaway scripts under
docs/collab/landscape-v1/scripts/B/) in the brief's fixed skeleton. Do not read handoff.md, do not open any
other file in docs/collab/, no commits.
```

- [ ] **Coordinator tab** (this session): say **"Round 1 launched"** -> it spawns the red team and waits.

- [ ] Tell the coordinator: **"Round 1 done"** -> it gate-checks and gives you the go for Round 2.

## Round 2 (same two tabs, after the coordinator says go)

- [ ] **Tab A**
```
Round 2. Read C:\work\TradeKit\docs\collab\landscape-v1\BRIEF_ROUND2.md with [me] = A and [other] = B, and
follow it exactly. Write only NOTES_FROM_A.md. Do not open NOTES_FROM_B.md or REDTEAM.md.
```

- [ ] **Tab B**
```
Round 2. Read C:\work\TradeKit\docs\collab\landscape-v1\BRIEF_ROUND2.md with [me] = B and [other] = A, and
follow it exactly. Write only NOTES_FROM_B.md. Do not open NOTES_FROM_A.md or REDTEAM.md. New measurements
stay read-only, same rules as Round 1.
```

- [ ] Tell the coordinator: **"Round 2 done"** -> it merges (Round 3, no paste from you), then names the closer.

## Round 4 (ONE tab -- the coordinator tells you whether it is A or B, and gives you the named-claims list)

- [ ] **Tab <closer>**
```
Round 4. You are the closer. Read C:\work\TradeKit\docs\collab\landscape-v1\BRIEF_ROUND4.md with [me] = <A|B>
and follow it exactly. The coordinator's named claims to verify: <paste the list the coordinator gave you>.
Write only MERGE_NOTES_FROM_<A|B>.md.
```

- [ ] Tell the coordinator: **"Round 4 done"**. On NEEDS REVISION it fixes the numbered points and gives you one
      more short paste for the same tab (Round 4b). On SHIP-READY it promotes the table and commits.

## Your decisions

After ship-ready, the coordinator shows you the decision table (`[DISPUTED]` rows and preference choices such as
capital top-up, time budget, second venue, which BUILD/EVALUATE to start). Those are yours. The Supabase key
rotation and any strategy change are executed after the campaign closes, not during it.
