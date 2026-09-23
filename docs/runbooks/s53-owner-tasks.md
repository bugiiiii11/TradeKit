# S53 — owner runbook

Written 2026-09-23 from the laptop lane. Four tasks, in the order they should be done.
Task A and Task B are independent; C is a message; D is optional and the only risky one.

Commits this covers: `2a28a6a..a5957e2` (8 commits, already on `origin/main`).

---

## Task A — rotate `SUPABASE_SERVICE_ROLE_KEY`

Leaked into a Claude session transcript on 2026-09-18 (a Realtime debug logger printed the
socket URL, which carries `?apikey=`). Never committed; `.env` itself was never exposed.
The key bypasses **all** RLS on every table.

### Who holds this key

**Three physical machines, three separate `.env` files.** `.env` is gitignored, so it does NOT
sync through git — editing it in one clone changes nothing anywhere else. Updating "the .env in
the project root" only ever fixes the machine you are sitting at.

| Machine | File | Consumer | Failure mode if it breaks |
|---|---|---|---|
| **VPS** (`170.9.253.98`) | `/home/ubuntu/trading-bot/.env` | pm2 `trading-bot` | Loud — bot logs Supabase errors |
| **VPS** (same file) | `/home/ubuntu/trading-bot/.env` | **dead-man cron** | **Silent.** Cron doesn't restart or complain. The watchdog that catches a dead WS loop just stops working |
| **Desktop** (has `C:/Work/.ssh/`) | `<its own clone>/.env` | desktop bot + scripts | Loud |
| **Laptop** (no `C:/Work/`) | `<its own clone>/.env` | scripts only | Loud |
| Vercel / frontend | — | — | Not affected. Frontend uses `sb_publishable_...` |

The VPS is reachable by SSH **only from the desktop** — the key is not on the laptop. So the
rotation cannot be completed from the laptop: it can update its own `.env` and stop there.

The dead-man row is why the order below ends with "verify before revoking".

### Shell

The verification scripts are plain Node — `npx ts-node src/scripts/...` behaves identically in
PowerShell and Git Bash. Shell only matters for shell syntax. PowerShell has no `$(date +%F)`;
use `"$(Get-Date -Format yyyy-MM-dd)"`. Everything on the VPS is Linux bash.

### Steps

**A1. Create the new key — do NOT revoke the old one yet.**

Supabase dashboard → project `gseztkzguxasfwqnztuo` → Project Settings → API Keys.
The new key format (`sb_secret_…`) allows more than one secret key at a time, so create a
second one and keep both live. That makes this a zero-downtime rotation instead of a race.

Copy the new value immediately — secret keys are shown once.

**A2. Laptop `.env`** — update the key in that machine's own clone, then prove it works:

```
npx ts-node src/scripts/check_ws_liveness.ts
```

Read-only, and it fails loudly on a bad key. Expect `VERDICT: ALIVE`.
**Done and verified 2026-09-23.** The laptop leg of this rotation is complete; nothing further
can be done from that machine, because it cannot reach the VPS.

**A3. Desktop `.env`** — same edit in the desktop's own clone, same check. A3 onward all happen
at the desktop.

**A4. VPS.** Back the file up first (bash, on the box):

```bash
ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98
cd /home/ubuntu/trading-bot
cp .env .env.bak.$(date +%F)
nano .env          # replace SUPABASE_SERVICE_ROLE_KEY
pm2 restart trading-bot
```

**A5. Verify the bot.** Read the log FILE — `pm2 logs --nostream` serves stale buffered lines:

```bash
tail -40 ~/.pm2/logs/trading-bot-out.log
```

Want: a clean startup block, no Supabase auth errors. Then within 15 min:

```bash
grep -a "Bar closed" ~/.pm2/logs/trading-bot-out.log | tail -3
```

**A6. Verify the dead-man — do not skip this.** Run it by hand rather than waiting for cron:

```bash
cd /home/ubuntu/trading-bot && /usr/bin/node --env-file=.env deploy/deadman-check.cjs
```

Want an `ok` line, not an auth error. Then confirm cron is still writing:

```bash
tail -3 ~/.pm2/logs/deadman.log
```

**A7. Only now revoke the old key** in the Supabase dashboard.

**A8. Re-verify after revoking.** This is what catches a `.env` you missed — until the old key
is dead, a stale copy keeps working and hides the mistake.

```bash
tail -20 ~/.pm2/logs/trading-bot-out.log
cd /home/ubuntu/trading-bot && /usr/bin/node --env-file=.env deploy/deadman-check.cjs
```

Plus `check_ws_liveness.ts` on both laptop and desktop.

**Rollback:** if anything breaks before A7, the old key is still live — restore `.env.bak.<date>`
and `pm2 restart trading-bot`.

---

## Task B — desktop deploy + VPS hygiene

Needs `C:/Work/.ssh/ssh-key-2026-03-11.key`, which exists only on the desktop.

### B1. Reconcile the desktop working tree BEFORE pulling

The desktop may still hold `keep/s52-commands-backoff` — a branch that is not on origin and
not on the laptop. S52 flagged it as at risk of dying with that working tree.

```bash
cd <repo>
git branch -a
git status -sb
git fetch origin
```

If the branch exists, push it before anything else — it is otherwise unrecoverable:

```bash
git push -u origin keep/s52-commands-backoff
```

Its content is now partly superseded: the backoff shipped in `f323afc` and the `CLOSED`
dedupe shipped in `35e4ce4`. Push it for the record, then it can be deleted.

Then:

```bash
git checkout main
git pull --ff-only     # expect 8 commits
```

### B2. Deploy to the VPS

Three live-runtime files changed: `src/db/commands.ts`, `src/main-headless.ts`,
`src/webhook/server.ts`.

```bash
ssh -i C:/Work/.ssh/ssh-key-2026-03-11.key ubuntu@170.9.253.98
cd /home/ubuntu/trading-bot
git status -sb         # clean (trade_log.json is skip-worktree)
git pull --ff-only
npx tsc --noEmit       # sanity; expect no output
pm2 restart trading-bot
```

### B3. Verify

```bash
tail -40 ~/.pm2/logs/trading-bot-out.log
```

The line that proves the webhook change landed:

```
[Bot-VPS] S5 cascade: ON (127.0.0.1:3456)
```

Restart counter — expect ↺ **47** (was 46 after S52):

```bash
pm2 list
```

Command channel — expect exactly one `Realtime subscription active`, and **no** repeating
`Resubscribing in Ns (attempt N)`:

```bash
grep -a "\[Commands\]" ~/.pm2/logs/trading-bot-out.log | tail -10
```

Bar-close loop, within 15 min:

```bash
grep -a "Bar closed" ~/.pm2/logs/trading-bot-out.log | tail -3
```

### B4. Confirm the tunnel still delivers — BEFORE touching the firewall

The webhook now binds `127.0.0.1` instead of `*`. Flash's sender arrives through an autossh
tunnel, which lands on localhost, so this should be transparent — but confirm it with a real
heartbeat before removing the firewall rule that is currently the only other thing keeping
port 3456 private. Heartbeats are hourly, so this may take up to ~65 minutes.

```bash
grep -a "Cascade received" ~/.pm2/logs/trading-bot-out.log | tail -3
```

Two things to check: a heartbeat arrived **after** the restart, and the new format is showing
full precision and the debt field:

```
[Webhook] Cascade received: severity=medium impact=$3.47M debt=$12.80M imminent=16 chains=...
```

If no heartbeat arrives within ~90 min, stop — do not touch iptables. Revert with
`S5_WEBHOOK_HOST=0.0.0.0` in `.env` + `pm2 restart trading-bot`, and tell Flash.

### B5. Drop the now-redundant iptables rule

Only after B4 passes.

```bash
sudo iptables -L INPUT -n --line-numbers | grep 3456
```

Note the line number, delete it, then re-list to confirm you removed the right one:

```bash
sudo iptables -D INPUT <line#>
sudo iptables -L INPUT -n --line-numbers | grep 3456    # expect nothing
```

Line numbers shift after every delete — always re-list rather than deleting two by number
in a row. Then persist, if `iptables-persistent` is installed:

```bash
sudo netfilter-persistent save
```

If it is not installed, the rule simply returns on reboot. Harmless, just untidy.

Re-check that the tunnel still delivers a heartbeat after this change.

### B6. Kill the stray `pm2 monit`

PID 311582, running since roughly 2026-05-04. Confirm it is what we think before killing:

```bash
ps -p 311582 -o pid,etime,cmd
```

Only if the output shows a `pm2 monit` process:

```bash
kill 311582
```

Do not `kill -9`, and do not kill it if the command line shows anything else — the box is
shared with Flash's three Sui liquidators.

---

## Task C — one question for Flash

Their `high` gate was described as *>10 imminent positions AND >$50M imminent debt*. Over
3,236 heartbeats (2026-05-06 → 2026-09-22) parsed out of `bot_logs`:

| Month | n | max impact | `imminent>10` | `≥$50M` |
|---|---|---|---|---|
| 2026-05 | 552 | $70M | 100% | 19 |
| 2026-06 | 690 | $50M | 100% | 8 |
| 2026-07 | 736 | $21M | 100% | 0 |
| 2026-08 | 738 | $1M | 69% | 0 |
| 2026-09 | 520 | $10M | 98% | 0 |

27 heartbeats in May–June met both stated conditions and still arrived as `medium`.

The caveat that keeps this a question and not a bug report: their gate is on *imminent debt*,
and the field we log is *estimated impact*. Those may be different numbers.

> We've been parsing your cascade heartbeats out of our logs. In May and June we see 27 of
> them with `estimated_impact_usd` ≥ $50M and `imminent_count` > 10 — the conditions you
> described for `high` — but every one arrived as `medium`. Is the `high` gate reading
> `aggregate_debt_usd` rather than `estimated_impact_usd`? We're about to grade severity on
> our side and want to key off the same field you do.

Handoff row 4 cannot be decided without this answer.

---

## Task D — optional, and the only one that can lose live data

Handoff row 11: stop tracking `trades/trade_log.json` in git. Marked "not urgent" since S48.
The VPS copy is live per-bot data (667 lines) held in place by `git update-index
--skip-worktree`. The repo copy is a stub.

**The hazard:** once the file is removed from the index, `git pull` on the VPS deletes the
working copy. Clearing `skip-worktree` without backing up first destroys the live log.

Skip this unless you actually want it done. If you do:

```bash
# 1. VPS — back up FIRST, verify the backup is non-empty
cd /home/ubuntu/trading-bot
cp trades/trade_log.json ~/trade_log.backup.$(date +%F).json
wc -l ~/trade_log.backup.$(date +%F).json     # expect ~667

# 2. Desktop — untrack, ignore, ship a stub
git rm --cached trades/trade_log.json
printf 'trades/trade_log.json\n' >> .gitignore
cp trades/trade_log.json trades/trade_log.example.json   # or write a minimal stub
git add .gitignore trades/trade_log.example.json
git commit -m "chore: stop tracking live trade_log.json"
git push origin main

# 3. VPS — clear the flag, pull (git WILL delete the file), restore
git update-index --no-skip-worktree trades/trade_log.json
git pull --ff-only
cp ~/trade_log.backup.$(date +%F).json trades/trade_log.json
wc -l trades/trade_log.json                   # expect ~667 again
pm2 restart trading-bot
```

Then confirm the bot still appends to it after the next trade.

---

## After all of this

Still open and deliberately not actioned:

- **Row 4 (S5 severity grading)** — blocked on Task C's answer, and on precise heartbeat data,
  which only starts accumulating from the B2 deploy. There is no honest basis for a threshold
  before then.
- **Row 6 (leverage)** — frozen at 1.0x. Nothing in the corrected matrix clears a significance bar.
- **Row 1** — decided 2026-09-23: keep S1+S6, no change to the bot.
