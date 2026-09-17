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

## Watchlist

> **Tier 0 watches — check before any other work each session.**

| Since | What | Why | Action if triggered |
|-------|------|-----|---------------------|
| 2026-08-20 | **WS bar-close loop liveness** (S44: 7d dead, S48: 54d dead) — **checked S51 2026-09-17: ALIVE**, newest bar close 0 min old. No ssh key on this laptop, so use `npx ts-node src/scripts/check_ws_liveness.ts` (ssh-free, reads the same Supabase signal as the dead-man cron). | pm2 "online" does NOT mean the bar-close loop is alive — the S5 webhook masks a dead WS. `pm2 logs --nostream` LIES (stale buffer) — read the log FILE. Don't trust the local machine clock (35h off in S46) — use the exchange clock. **Now guarded 3 ways (S48):** reconnect watchdog (`dbbe9c6`, 3 min stuck → `process.exit` → pm2 restart, ↺ counter climbs), digest shows `Last bar close: Nmin ago`, and the external dead-man cron posts to Discord `#errors` if >35 min stale. **If Discord is quiet, it still means check** — the dead-man itself is new and unproven on a real outage. | Liveness: `ssh … "tail -5 ~/.pm2/logs/trading-bot-out.log"` — newest `Bar close` within ~15 min. Dead-man health: `ssh … "tail -3 ~/.pm2/logs/deadman.log"` (should say `ok` every 15 min). Exchange clock: `curl -s -X POST https://api.hyperliquid.xyz/info -H 'Content-Type: application/json' -d '{"type":"candleSnapshot","req":{"coin":"BTC","interval":"15m","startTime":1750000000000,"endTime":1800000000000}}'` → last candle `T` = real time. If ↺ > 45, a watchdog/self-heal restart fired — read the error log for why. |
| 2026-08-20 | **First trade after the outage** — **S51: PARTLY CLOSED.** The bot resumed trading in late Aug (trades through Sep 15), so this row's premise "no position since Jul 1" was stale. (a) S46 oid capture **VALIDATED** — 4 ratcheting modifies on 2026-09-14, Y≠X every time, zero `Failed to modify` since 2026-06-25. (b) Hydration with an open profitable position **still unexercised** (last restart 2026-08-20 logged `No open positions to hydrate`). (c) command channel unchecked. | No position since Jul 1. The next entry exercises: (a) `aa15560` oid capture — expect `[Orders] Stop-loss modified: oid=X → Y` with Y ≠ X and NO `Failed to modify SL`; (b) if the bot restarts while that position is in profit, hydration must log it as `SL=$…` (not `1 TP(s)`) and trailing must continue; (c) command channel still `active` (kill switch reachable). | `ssh … "grep -a -E 'Stop-loss modified|Failed to modify|hydrat' ~/.pm2/logs/trading-bot-out.log \| tail -20"` |
| 2026-09-17 | **Command channel flapping every 30s** (S51 find) | `[Commands] Realtime subscription closed — resubscribing in 30s` → `Resubscribing` → `Startup sweep` → `Realtime subscription active`, then closed again 30s later. Continuous, at least all of 2026-09-17. The S48 auto-resubscribe (listed in CLAUDE.md as never observed firing) is firing ~2,880×/day. **Kill switch is degraded, not dead:** each resubscribe runs a startup sweep that claims pending commands, so a command lands within ~30s instead of instantly. **Side effect:** ~11k junk rows/day into `bot_logs`, which is the durable forensic log — it will bury real events. Root cause unknown; suspect a channel leak (new channel per resubscribe without removing the old) or a Realtime/key config issue. | Query `bot_logs` where `source='commands'` — if the 30s cycle is gone, it self-healed. Fix lives in `src/db/commands.ts`. |
| 2026-05-06 | S5 cascade pipe LIVE | Receiving `medium` heartbeats hourly (still the only severity ever seen). Monitor for first `high`. | `ssh … "grep -a -i cascade ~/.pm2/logs/trading-bot-out.log \| grep -v medium \| tail"` |
| 2026-08-20 | Balance | Account value **$381.56**, flat, all withdrawable (S1 SHORT +$4.27 on Jul 1 folded in). Bot bankroll hydrates from trade log — check the startup `Bankroll:` line matches ±funding. | `ssh … "grep -a Balance ~/.pm2/logs/trading-bot-out.log \| tail -2"` |

## What To Do Next

| # | Task | Risk | Notes |
|---|------|------|-------|
| 1 | **Live vs backtest divergence on S6** | high | The most substantive open question. Backtest S6 = 47-50% WR at ~156 trades/yr; live S6 = 32% WR at ~75 trades/yr over 22 trades. Half the rate, 15 points of win rate. The backtest models something the bot is not doing (entry at 15m close, fills, slippage). Until explained, no backtest PF is a live forecast — and G4/G6 would be tuned against a model that does not match reality. Do this before Sprint 3. |
| 2 | **Fix the command-channel 30s flap** (`src/db/commands.ts`) | med | S51 find, see Watchlist. Kill switch degraded to ~30s latency; `bot_logs` taking ~11k junk rows/day. Diagnose from any machine (query `bot_logs` `source='commands'`); the fix needs a VPS deploy, so it pairs with row 3. Suspect a channel leak — new channel per resubscribe without removing the old. |
| 3 | **Get ssh access to the VPS — task for Matt** | med | No VPS key on the owner laptop (checked S51: `config`, both `.bak`s, every key file). `ssh ubuntu@170.9.253.98` → `Permission denied (publickey)`. Every Watchlist command is written as `ssh …` and is unrunnable there. Box may have moved (Contabo?); logs show `/home/ubuntu/trading-bot`, which proves layout not host. Public key is in commit `5d0d1c3`. Blocks rows 2 and 4. |
| 4 | **Verify the dead-man cron is alive** | med | `tail -5 ~/.pm2/logs/deadman.log` — an `ok` line every 15 min. Unchecked since S48 because of row 3. If the log stopped, the safety net itself is down. |
| 5 | **Leave the bot alone and let it trade** | low | Healthy as of 2026-09-17 (24 bar closes in 6h, on cadence). Avoid restarts unless something is actually wrong. Still unexercised: hydration with an open *profitable* position (last restart 2026-08-20 found none). |
| 6 | **Leverage decision (still 1.0x)** | low | Live bot trades now number ~46 closed, but per-strategy: S1 1, S6 22. Revisit once S6 alone clears ~30 and row 1 is understood. |
| 7 | **2 bot trades lack strategy attribution** | low | Trades page: 46 bot trades (14W/32L) vs 44 in the scoreboard (S1 1 + S2 4 + S3 17 + S6 22). Small gap in `entry_conditions.strategy`; it silently drops trades from every per-strategy number. |
| 8 | **Meta Signals summary → Martin** | low | S38: no API/webhook, Discord-only. Recommend manual trade dashboard. Ask about $179/mo subscription. |
| 9 | **Martin's TV setups → manual trades** | med | Manual trade infra ready (S28). Hydration (S32 trade-log match + S48 order-type SL/TP) protects web UI trades. |
| 10 | **S2 / S3 / S7 re-evaluation** | low | All parked. Revisit only on logic rework. |
| 11 | **Optional: stop tracking `trades/trade_log.json` in git** | low | Live per-bot data (VPS 667 lines vs repo stub). Currently `skip-worktree` on the VPS. Cleaner: `.gitignore` + a committed `trade_log.example.json`. Not urgent. |

## Session Summary

| Session | Date | Title |
|---------|------|-------|
| 48 | 2026-08-20 | P0: WS loop dead 54 days — recovered, hardened, dead-man cron added |
| 49 | 2026-08-21 | Docs only: Rein x TradeKit assessment |
| 50 | 2026-09-17 | Polish audit + Sprint 1 (thought shipped; was not deployed) |
| 51 | 2026-09-17 | Vercel never deployed Sprint 1; Sprint 2 out-of-sample; command-channel flap found |
