# Handoff Archive (do not read on /start)

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

## What Was Done (Session 50) — Polish audit + Sprint 1 shipped (market-data fix, strategy instrument)

*(Session 49 was docs-only: `977a9aa` Rein x TradeKit assessment. This machine was 84 commits behind and was fast-forwarded first.)*

- **`/polish scan` audit written:** `docs/polish/tradekit-polish-audit.md` — 16 items, 5 sprints, none Risk-H. Root causes: (A1) market-data page crashed on `.toFixed(null)` because the bot warms up 250 daily bars but 1D PMARP/BBWP need 350/252, NaN -> null in Supabase JSON; (A2) the -$25.74 / 29% headline sums the dead S3/S2 eras with the live S1+S6 set and there was no per-strategy instrument; (G3) every backtest is in-sample — no walk-forward split exists.
- **Sprint 1 shipped + pushed (`4647567`, frontend only, bot untouched):** null-safe market-data page; trades page with date column, strategy column, per-strategy scoreboard (live vs backtest reference, red when >= 10 trades and 10 pts under), default window "since current config" 2026-06-01 with All-time toggle; strategies page joined on `entry_conditions.strategy`, S6 card (in-page fallback, DB row optional — SQL in the record), LIVE/DISABLED badges. Verified: tsc, eslint, `next build` all 0. Record: `docs/polish/tradekit-polish.md`.
- **Owner rules recorded:** push after every sprint; list blockers before the next phase.
- **Not done / not touched:** no VPS liveness check this session (Watchlist rows 1-2 still due); Supabase MCP unauthorised (row shapes inferred from `src/db/*.ts`); no browser smoke (pages behind login).
