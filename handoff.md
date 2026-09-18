# TradeKit — Session Handoff

> Single source of truth for resuming work across chat sessions.
> Updated by `/wrap`. Read by `/start` at the beginning of each session.
>
> **Trimming convention:** Keep only the last ~3 sessions here. When a session
> is older than that and fully documented (code committed, docs updated), move
> it to `docs/session-archive.md`. This keeps handoff.md small and focused.
>
> **Permanent project context** (architecture, key files, risk config, security)
> lives in `CLAUDE.md` (auto-loaded every message). Do NOT duplicate it here.

---

## What Was Done (Session 50) — Polish audit + Sprint 1 shipped (market-data fix, strategy instrument)

*(Session 49 was docs-only: `977a9aa` Rein x TradeKit assessment. This machine was 84 commits behind and was fast-forwarded first.)*

- **`/polish scan` audit written:** `docs/polish/tradekit-polish-audit.md` — 16 items, 5 sprints, none Risk-H. Root causes: (A1) market-data page crashed on `.toFixed(null)` because the bot warms up 250 daily bars but 1D PMARP/BBWP need 350/252, NaN -> null in Supabase JSON; (A2) the -$25.74 / 29% headline sums the dead S3/S2 eras with the live S1+S6 set and there was no per-strategy instrument; (G3) every backtest is in-sample — no walk-forward split exists.
- **Sprint 1 shipped + pushed (`4647567`, frontend only, bot untouched):** null-safe market-data page; trades page with date column, strategy column, per-strategy scoreboard (live vs backtest reference, red when >= 10 trades and 10 pts under), default window "since current config" 2026-06-01 with All-time toggle; strategies page joined on `entry_conditions.strategy`, S6 card (in-page fallback, DB row optional — SQL in the record), LIVE/DISABLED badges. Verified: tsc, eslint, `next build` all 0. Record: `docs/polish/tradekit-polish.md`.
- **Owner rules recorded:** push after every sprint; list blockers before the next phase.
- **Not done / not touched:** no VPS liveness check this session (Watchlist rows 1-2 still due); Supabase MCP unauthorised (row shapes inferred from `src/db/*.ts`); no browser smoke (pages behind login).

## What Was Done (Session 51) — Sprint 1 was never deployed; Sprint 2 shipped; two live-bot findings

**The session's headline: Sprint 1 had been pushed but never deployed.** The Vercel `trade-kit` project had
no connected Git repo, so every deploy in its 157-day history was a manual CLI deploy. S50 treated "pushed"
as "shipped"; the live site served a 27-day-old build, which is why market-data still 500'd. Owner reconnected
GitHub in the dashboard mid-session; all four pushes after that auto-deployed. CLAUDE.md's "auto-deploys on
push to `main`" line was simply false and is now corrected.

- **Sprint 1 verified** on all three pages, plus one defect found and fixed: the G2 card sort comparator had
  `a`/`b` swapped, so DISABLED strategies sorted ahead of LIVE (`da62d07`).
- **Sprint 2 shipped (`a6cd77f`) — G3 + G5, backtests only, no live change.** New `src/scripts/backtest_oos.ts`
  (loads once, splits, replays a 5-config matrix on both windows); `--train-until` / `--test-from` on
  `backtest_binance.ts`; regime filter generalised off the hardcoded `"S3"` via `regimeFilterStrategies` +
  `regimeBlockWhen` (defaults preserve every archived S3 number).
- **Two engine bugs found while running it, both of which produced fake results.** (1) The regime filter never
  reached S6 — S6 bypasses the confluence scorer and enters via the independent path at `engine.ts:477`, so the
  first run returned "S6 + regime" byte-identical to "S6 only". **Any filter added to the confluence block will
  no-op on S6 the same way.** (2) The train window silently collapsed to 148 days: `aligner.ts` needs a warm
  *daily* PMARP (~370 daily bars), so ~1 year of any download is eaten as warmup — 31 months downloaded gave 19
  usable. Needs `--months=55`.
- **Result — the live S1+S6 set holds up out-of-sample:** PF 1.99 on 182 test trades (2025-07-01 → 2026-09-17),
  decaying mildly from 2.33 in an 878-day train window. Full table + caveats in `docs/polish/tradekit-polish.md`.
- **Owner decision: do NOT ship the regime filter on S6.** It shows PF 8.33 / Sharpe 8.05, but on 38 trades that
  is an artifact, and it cuts trades 79% to earn $39 *less*.
- **Live bot checked without ssh** (`5d0d1c3`) — new `src/scripts/check_ws_liveness.ts` reads the same Supabase
  signal as the dead-man cron, clocked against Hyperliquid rather than the local machine. Verdict ALIVE: 24 bar
  closes in 6h, on cadence.
- **S46 trailing-oid fix VALIDATED on real trades** — 2026-09-14 shows four consecutive
  `Stop-loss modified: oid=X → Y` (Y ≠ X) ratcheting $77541.5 → $77831.6; last `Failed to modify` was
  2026-06-25, pre-fix. Watchlist row 2's premise ("no position since Jul 1") was stale — the bot resumed
  trading in late August.
- **New defect found: the command channel flaps every 30s** (`a5958c0`, see Watchlist). Kill switch degraded,
  not dead. CLAUDE.md had this path listed as never observed firing.
- **Untracked April files kept deliberately** (5 backtest logs, `image.png`, `src/docs/analysis-and-recommendations.md`)
  — owner wants them for comparison against the new out-of-sample numbers. Not junk; do not clean up.

## What Was Done (Session 52) — Flap fix deployed; VPS reachable from the desktop; Flash cross-check

*Ran on the desktop (the machine with the VPS key), starting from a clone 10 commits behind — `/start` reported "up to date" because it never fetched. S50/S51 (laptop) were invisible until a push was rejected. Lesson folded into `/start` (fetch first).*

- **Tier-0 checks from the box, all green** (01:06Z): bar-close loop current vs exchange clock, pm2 ↺=45 stable since Aug 20, dead-man cron `ok` every 15 min, crontab intact. First on-box verification since S48.
- **SSH solved, no new key needed.** The OCI key lives only on the desktop at `C:/Work/.ssh/ssh-key-2026-03-11.key` (documented in Flash's `.claude/reference.md`, not TradeKit). S51's row 3 said the public key was in `5d0d1c3` — that commit exists but holds no key material; nothing was ever committed. Box never moved (Contabo is a Flash-only box). Neo's relayed request is therefore answered: the checks he asked for are done. **Granting Neo a shell is Martin's call** — Flash's position is no third-party shell on OCI2 (its Sui liquidator wallet keys live under `/home/ubuntu/flash/`); if ever needed, a separate user with no read access there.
- **Command-channel flap: root-caused independently, then found already fixed upstream.** Log timestamps were 30.000s apart to the millisecond — our own `RESUBSCRIBE_DELAY_MS`, not a heartbeat. `removeChannel()` fires the old channel's subscribe-callback with `CLOSED`; the handler re-armed the timer, which then killed the healthy new channel every 30s since one genuine close on 2026-08-22 21:39Z (27 days, ~11.5k rows/day, 96% of `bot_logs`). S51's `35e4ce4` fixes the same mechanism and was verified against live Supabase with an induced close, so it was deployed instead of the desktop's duplicate (parked locally on branch `keep/s52-commands-backoff` — adds backoff 30s→5min + `CLOSED` dedupe; follow-up).
- **Deployed `71d3422` to the VPS** (`git pull --ff-only` + `pm2 restart`, ↺ 45→46). Only one live-runtime file changed (`commands.ts`; `types.ts` is a type-only import in `candle-consumer.ts`; tree type-checks clean). Result: **2 command rows since restart** (sweep + active) where the old code wrote ~4 per 30s. First post-restart bar close confirmed (see Watchlist row 1).
- **Hydration on a real restart:** open position is a **manual** web-UI long (0.0026 BTC @ $76,873, 10x, SL $75,800, 1 TP, opened 2026-09-17 17:28Z) — hydrated as `[external (skip exit logic)]`, correct. Bankroll hydrated $349.56. In-profit *bot* position hydration still unexercised.
- **Flash cross-check** (briefs in `c:/work/Flash/___temp/tradekit-brief-2026-09-18.md` + `flash-reply-…md`): S5 `high` is crash-only by design (needs >10 imminent AND >$50M imminent debt; Sept peak $5.87M) — 4 months of `medium` is expected. Flash recommends grading severity on our side from the hourly heartbeat's `estimated_impact_usd`. Box hygiene from Flash: stray `pm2 monit trading-bot` PID 311582 running 142 days; webhook binds `*:3456` with an iptables ACCEPT — only the OCI VCN keeps it private; bind `127.0.0.1` (tunnel arrives on localhost). Port-3456 contract must not change: `GET /health`→200, `POST /webhook/cascade`→`{accepted:true}`.
- **S51's `check_command_channel.ts` reports FLAPPING for ~2h after a fix** — fixed 2h window, pre-restart rows dominate. Trust rows-since-restart instead until it gets a since-last-active mode.

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-08-20 | **WS bar-close loop liveness** (S44: 7d dead, S48: 54d dead) — **checked S52 2026-09-18 from the box: ALIVE**, dead-man cron `ok` every 15 min, post-restart bar close confirmed. From the laptop (no key) use `npx ts-node src/scripts/check_ws_liveness.ts`; from the desktop ssh with `-i C:/Work/.ssh/ssh-key-2026-03-11.key`. | pm2 "online" does NOT mean the bar-close loop is alive — the S5 webhook masks a dead WS. `pm2 logs --nostream` LIES (stale buffer) — read the log FILE. Don't trust the local machine clock (35h off in S46) — use the exchange clock. **Now guarded 3 ways (S48):** reconnect watchdog (`dbbe9c6`, 3 min stuck → `process.exit` → pm2 restart, ↺ counter climbs), digest shows `Last bar close: Nmin ago`, and the external dead-man cron posts to Discord `#errors` if >35 min stale. **If Discord is quiet, it still means check** — the dead-man itself is new and unproven on a real outage. | Liveness: `ssh … "tail -5 ~/.pm2/logs/trading-bot-out.log"` — newest `Bar close` within ~15 min. Dead-man health: `ssh … "tail -3 ~/.pm2/logs/deadman.log"` (should say `ok` every 15 min). Exchange clock: `curl -s -X POST https://api.hyperliquid.xyz/info -H 'Content-Type: application/json' -d '{"type":"candleSnapshot","req":{"coin":"BTC","interval":"15m","startTime":1750000000000,"endTime":1800000000000}}'` → last candle `T` = real time. If ↺ > 45, a watchdog/self-heal restart fired — read the error log for why. |
| 2026-08-20 | **First trade after the outage** — **S51: PARTLY CLOSED.** The bot resumed trading in late Aug (trades through Sep 15), so this row's premise "no position since Jul 1" was stale. (a) S46 oid capture **VALIDATED** — 4 ratcheting modifies on 2026-09-14, Y≠X every time, zero `Failed to modify` since 2026-06-25. (b) Hydration with an open profitable position **still unexercised** (last restart 2026-08-20 logged `No open positions to hydrate`). (c) command channel: flap **FIXED + deployed S52** (`35e4ce4`). **S52:** hydration of an open *manual* position on a real restart validated; the in-profit *bot* case remains. | No position since Jul 1. The next entry exercises: (a) `aa15560` oid capture — expect `[Orders] Stop-loss modified: oid=X → Y` with Y ≠ X and NO `Failed to modify SL`; (b) if the bot restarts while that position is in profit, hydration must log it as `SL=$…` (not `1 TP(s)`) and trailing must continue; (c) command channel still `active` (kill switch reachable). | `ssh … "grep -a -E 'Stop-loss modified|Failed to modify|hydrat' ~/.pm2/logs/trading-bot-out.log \| tail -20"` |
| 2026-09-17 | **Command channel flapping every 30s** (S51 find) — **FIXED S52:** `35e4ce4` deployed 2026-09-18 01:06Z; 2 command rows since restart vs ~4 per 30s before. Drop this row after one clean session. | `[Commands] Realtime subscription closed — resubscribing in 30s` → `Resubscribing` → `Startup sweep` → `Realtime subscription active`, then closed again 30s later. Continuous, at least all of 2026-09-17. The S48 auto-resubscribe (listed in CLAUDE.md as never observed firing) is firing ~2,880×/day. **Kill switch is degraded, not dead:** each resubscribe runs a startup sweep that claims pending commands, so a command lands within ~30s instead of instantly. **Side effect:** ~11k junk rows/day into `bot_logs`, which is the durable forensic log — it will bury real events. Root cause unknown; suspect a channel leak (new channel per resubscribe without removing the old) or a Realtime/key config issue. | Count `bot_logs` rows with `source='commands'` since the last restart — should be a handful, not one per 30s. `check_command_channel.ts` uses a fixed 2h window and says FLAPPING for ~2h after any fix; don't trust its verdict inside that window. |
| 2026-05-06 | S5 cascade pipe LIVE | Receiving `medium` heartbeats hourly. **S52 (Flash):** sender is `liq-morpho-eth` on Contabo via autossh tunnel; `high` needs >10 imminent positions AND >$50M imminent debt — Sept peak $5.87M, so `high` is crash-only by design. Medium-only is expected, not a fault. | `ssh … "grep -a -i cascade ~/.pm2/logs/trading-bot-out.log \| grep -v medium \| tail"` |
| 2026-09-18 | Balance | S52 restart hydrated bankroll **$349.56** (dailyPnl −$2.46; was $381.56 on Aug 20). Open **manual** BTC long 0.0026 @ $76,873, 10x, SL $75,800 (web UI, 2026-09-17 17:28Z) — bot skips exit logic on it. Six bot trades Sep 4→15 net ≈ −$2.66. Check the startup `Bankroll:` line matches ±funding. | `ssh … "grep -a Balance ~/.pm2/logs/trading-bot-out.log \| tail -2"` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Re-run every backtest decision on corrected alignment** | high | Row 1's divergence is ANSWERED (S52, `71d3422`): the aligner fed the engine the still-forming higher-TF bar, i.e. up to 45min/3h45m/23h45m of future data on 1H/4H/1D. Both halves dissolved — the "half rate" was calendar days including the 66-day outage (same active window: live 22 trades vs backtest 29), and the WR gap fell from 16 points to 6 on n=22, i.e. noise. **The cost: every archived number in this repo is inflated.** Live set S1+S6 out-of-sample goes PF 1.99 → **1.03** ($190 → $6 over 444d); S1 alone PF 11.94 → 0.92. So re-decide on honest numbers: (a) S51's 5-config out-of-sample matrix, (b) the S6 regime filter that was rejected at PF 8.33 (the comparison may invert now that plain S6 is PF 1.03), (c) S2/S3 were parked on inflated numbers too. `npx ts-node src/scripts/backtest_lookahead_ab.ts`. Gates rows 6 and 10 and any Sprint 3. |
| 2 | **VPS hygiene from Flash's review** (needs the desktop key) | low | (a) kill stray `pm2 monit trading-bot` PID 311582 (142 days old); (b) bind the S5 webhook to `127.0.0.1` — add `S5_WEBHOOK_HOST` to `server.listen`, default loopback (tunnel arrives on localhost; keep port 3456 and the `/health` + `{accepted:true}` contract); (c) then drop the iptables `--dport 3456 ACCEPT` rule (sudo; check rules persistence first). |
| 3 | **Command-channel follow-ups** | low | (a) Merge the parked backoff + `CLOSED`-dedupe from branch `keep/s52-commands-backoff` (desktop-local, patch also in that session's scratchpad) — with the deployed fix a *persistently* failing channel still writes ~3 rows/30s; (b) give `check_command_channel.ts` a since-last-restart mode so it stops saying FLAPPING for 2h after a fix. |
| 4 | **S5 severity grading on our side** | med | Flash: `high` is crash-only (>$50M imminent debt; observed peak $5.87M). The hourly heartbeat already carries `estimated_impact_usd` + `aggregate_debt_usd` — grade in `s5_cascade.ts` from those instead of waiting for Flash's `high`. Alternative: ask Flash to lower the gate (5-line change on their side). Decide the threshold before touching code. |
| 5 | **Leave the bot alone and let it trade** | low | Healthy as of 2026-09-17 (24 bar closes in 6h, on cadence). Avoid restarts unless something is actually wrong. Still unexercised: hydration with an open *profitable* position (last restart 2026-08-20 found none). |
| 6 | **Leverage decision (still 1.0x)** | low | Live bot trades now number ~46 closed, but per-strategy: S1 1, S6 22. Revisit once S6 alone clears ~30 and row 1 is understood. |
| 7 | ~~2 bot trades lack strategy attribution~~ **— not a bug (S52)** | low | Queried all 51 `trades` rows: **zero** have a missing `entry_conditions.strategy`. The 46-vs-44 gap is the frontend scoreboard excluding the 3 `strategy:"manual"` rows written by `vps-bot` (plus 1 `S3|bot` desktop row). Nothing is lost; if the count should reconcile, fix it in the scoreboard, not the bot. |
| 8 | **Meta Signals summary → Martin** | low | S38: no API/webhook, Discord-only. Recommend manual trade dashboard. Ask about $179/mo subscription. |
| 9 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (S28). Hydration (S32 trade-log match + S48 order-type SL/TP) protects web UI trades. |
| 10 | **S2 / S3 / S7 re-evaluation** | low | All parked. Revisit only on logic rework. |
| 11 | **Optional: stop tracking `trades/trade_log.json` in git** | low | Live per-bot data (VPS 667 lines vs repo stub). Currently `skip-worktree` on the VPS. Cleaner: `.gitignore` + a committed `trade_log.example.json`. Not urgent. |
| 13 | **Rotate `SUPABASE_SERVICE_ROLE_KEY`** — flagged S52, deferred by owner | med | Leaked into a Claude session transcript on 2026-09-18: a Realtime debug logger printed the socket URL, which carries `?apikey=sb_secret_…`. The key bypasses ALL RLS. Not known to be exposed anywhere else (never committed; `.env` untouched). Rotate in the Supabase dashboard → update VPS `.env` + local `.env` → `pm2 restart trading-bot`. Do not enable that logger again. |
| 14 | **Stored/displayed backtest numbers are pre-fix** | med | Every `backtest_results` row in Supabase, the frontend backtests page, and the per-strategy "backtest reference" on the trades scoreboard (S50 Sprint 1) were produced under lookahead. The scoreboard now flags live WR as underperforming against a reference that never existed. Either re-run and replace, or label the legacy rows. |
| 12 | **Neo's VPS access — Martin's decision** | med | Checks he asked for are done (S52). Flash's position: no third-party shell on OCI2 (Sui wallet keys under `/home/ubuntu/flash/`). If access is truly needed: a separate user with no read access to `/home/ubuntu/flash/*`, key sent directly by Neo — never sourced from repo history. |

## Session Summary

| Session | Date | Title |
|---------|------|-------|
| 48 | 2026-08-20 | P0: WS loop dead 54 days — recovered, hardened, dead-man cron added |
| 49 | 2026-08-21 | Docs only: Rein x TradeKit assessment |
| 50 | 2026-09-17 | Polish audit + Sprint 1 (thought shipped; was not deployed) |
| 51 | 2026-09-17 | Vercel never deployed Sprint 1; Sprint 2 out-of-sample; command-channel flap found |
| 52 | 2026-09-18 | Flap fix deployed to VPS; on-box Tier-0 checks green; SSH solved (desktop key); Flash cross-check |
