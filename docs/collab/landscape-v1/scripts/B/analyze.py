"""
Throwaway (Landscape v1, seat B). Pure analysis over the JSON dumps in the scratchpad
(hl.json, trades.json, logs.json, c15.json, vps_trade_log.json, orders.json). Read-only.
Run:  PYTHONIOENCODING=utf-8 python -I docs/collab/landscape-v1/scripts/B/analyze.py <scratch_dir>
"""
import json, sys, re, statistics as st, datetime as dt
from collections import Counter

SC = sys.argv[1].rstrip("/\\") + "/"
hl = json.load(open(SC + "hl.json"))
T = json.load(open(SC + "trades.json"))["trades"]
L = json.load(open(SC + "logs.json"))
C15 = json.load(open(SC + "c15.json"))
O = json.load(open(SC + "orders.json"))

def iso(ms): return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).isoformat()[:19]
def pms(s):
    s = s.replace("Z", "+00:00")
    if "+" not in s[10:]: s += "+00:00"
    return int(dt.datetime.fromisoformat(s).timestamp() * 1000)
def q(xs, p):
    xs = sorted(xs);
    if not xs: return float("nan")
    k = (len(xs) - 1) * p; f = int(k); c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)

W1 = pms("2026-08-20T00:00:00Z"); W2 = pms("2026-09-23T00:00:00Z")
DEAD = pms("2026-10-18T09:45:00Z"); NOW = pms(hl["fetchedAt"])
H = 3600_000; B15 = 900_000

# ---------------------------------------------------------------- trips from fills
fills = sorted([f for f in hl["fills"] if f["time"] >= W1], key=lambda f: (f["time"], f["tid"]))
trips = []; cur = None
for f in fills:
    sz = float(f["sz"]); sp = float(f["startPosition"]); signed = sz if f["side"] == "B" else -sz
    if cur is None: cur = {"entry_fills": [], "exit_fills": [], "dir": "long" if signed > 0 else "short", "t0": f["time"]}
    (cur["entry_fills"] if f["dir"].startswith("Open") else cur["exit_fills"]).append(f)
    if abs(sp + signed) < 1e-9 and cur["exit_fills"]:
        cur["t1"] = f["time"]; trips.append(cur); cur = None
if cur: print("!! OPEN TRIP at end", cur["t0"])
orders = O["orders"]
for tr in trips:
    ef, xf = tr["entry_fills"], tr["exit_fills"]
    tr["size"] = sum(float(f["sz"]) for f in ef)
    tr["entry_px"] = sum(float(f["sz"]) * float(f["px"]) for f in ef) / tr["size"]
    xs = sum(float(f["sz"]) for f in xf); tr["exit_px"] = sum(float(f["sz"]) * float(f["px"]) for f in xf) / xs
    tr["notional"] = tr["size"] * tr["entry_px"]
    tr["fees"] = sum(float(f["fee"]) for f in ef + xf)
    tr["gross"] = sum(float(f["closedPnl"]) for f in xf)
    tr["funding"] = sum(float(x["delta"]["usdc"]) for x in hl["funding"] if tr["t0"] < x["time"] <= tr["t1"])
    tr["net"] = tr["gross"] - tr["fees"] + tr["funding"]
    tr["hold_h"] = (tr["t1"] - tr["t0"]) / H
    tr["entry_oid"] = ef[0]["oid"]
    m = [t for t in T if abs(pms(t["entry_time"]) - tr["t0"]) < 180_000 and t["side"] == tr["dir"]]
    tr["sb"] = m[0] if m else None
    tr["strategy"] = ((m[0].get("entry_conditions") or {}).get("strategy") if m else None) or "UNMATCHED"
    tr["exit_reason"] = m[0]["exit_reason"] if m else "?"
    # bot's own mark price at order time, from [Orders] Market line with this oid
    mk = [r for r in orders if f"oid: {tr['entry_oid']}" in r["message"] and "Market" in r["message"]]
    tr["mark_px"] = float(re.search(r"@ ~\$([\d.]+)", mk[0]["message"]).group(1)) if mk else None
    # last stop trigger before exit (modified or set), within trip
    trig = None
    for r in orders:
        tms = pms(r["ts"])
        if tr["t0"] - 10_000 <= tms <= tr["t1"]:
            mm = re.search(r"Stop-loss (?:set|modified).*?\$([\d.]+)", r["message"].replace("trigger $", "$"))
            if "Stop-loss set" in r["message"] or "Stop-loss modified" in r["message"]:
                m2 = re.search(r"\$([\d.]+)\s*$", r["message"].strip()) or re.search(r"set @ \$([\d.]+)", r["message"])
                if m2: trig = float(m2.group(1))
    tr["last_trigger"] = trig

def stats(ts, label, bank):
    if not ts: print(f"{label}: n=0"); return
    nets = [t["net"] for t in ts]; wins = [x for x in nets if x > 0]; loss = [x for x in nets if x <= 0]
    pf = (sum(wins) / abs(sum(loss))) if loss and sum(loss) != 0 else float("inf")
    cum = 0; peak = 0; dd = 0
    for t in sorted(ts, key=lambda t: t["t1"]):
        cum += t["net"]; peak = max(peak, cum); dd = min(dd, cum - peak)
    longs = [t for t in ts if t["dir"] == "long"]; shorts = [t for t in ts if t["dir"] == "short"]
    sd = st.pstdev(nets) if len(nets) > 1 else 0
    print(f"{label}: n={len(ts)} WR={len(wins)/len(ts)*100:.0f}% PF={pf:.2f} avgW={st.mean(wins) if wins else 0:+.2f} avgL={st.mean(loss) if loss else 0:+.2f} "
          f"gross={sum(t['gross'] for t in ts):+.2f} fees={sum(t['fees'] for t in ts):.2f} funding={sum(t['funding'] for t in ts):+.3f} NET={sum(nets):+.2f} "
          f"({sum(nets)/bank*100:+.2f}% of ${bank}) maxDD={dd:.2f} ({dd/bank*100:.1f}%) avgHold={st.mean(t['hold_h'] for t in ts):.1f}h "
          f"long n={len(longs)} net={sum(t['net'] for t in longs):+.2f} | short n={len(shorts)} net={sum(t['net'] for t in shorts):+.2f} | mean/trade={st.mean(nets):+.3f} sd={sd:.2f} se={sd/len(nets)**0.5:.2f}")

print("=" * 100); print("AXIS 1 — trips from Hyperliquid fills (VPS master 0x5642…4110), joined to Supabase trades")
print("=" * 100)
for tr in trips:
    sb = tr["sb"]
    print(f"{iso(tr['t0'])} → {iso(tr['t1'])} {tr['strategy']:<9} {tr['dir']:<5} sz={tr['size']:.5f} e={tr['entry_px']:.1f} (mark {tr['mark_px']}) x={tr['exit_px']:.1f} "
          f"gross={tr['gross']:+.3f} fee={tr['fees']:.3f} fund={tr['funding']:+.4f} NET={tr['net']:+.3f} hold={tr['hold_h']:.1f}h {tr['exit_reason']} "
          f"sb_pnl={sb['pnl_usd'] if sb else None} sb_exit={sb['exit_price'] if sb else None} trig={tr['last_trigger']} entry_oid={tr['entry_oid']}")
bot = [t for t in trips if t["strategy"] not in ("manual",)]
print(f"\nTrips total={len(trips)} bot={len(bot)} manual={len(trips)-len(bot)} unmatched={sum(1 for t in trips if t['strategy']=='UNMATCHED')}")
print(f"Supabase closed trades since W1 (vps-bot, non-manual): {sum(1 for t in T if pms(t['entry_time'])>=W1 and (t.get('entry_conditions') or {}).get('strategy')!='manual')}")
print(f"Supabase pnl_usd sum (bot, since W1) = {sum(t['pnl_usd'] for t in T if pms(t['entry_time'])>=W1 and (t.get('entry_conditions') or {}).get('strategy')!='manual'):+.2f} vs fills gross {sum(t['gross'] for t in bot):+.2f} vs fills NET {sum(t['net'] for t in bot):+.2f}")
print()
for (lab, w0, bank) in (("since 2026-08-20", W1, 381.56), ("since 2026-09-23", W2, 382.33)):
    sel = [t for t in bot if t["t0"] >= w0]
    print(f"--- window {lab} (bankroll anchor ${bank} = first logged balance) ---")
    stats(sel, "ALL bot", bank)
    for s in ("S1", "S6"): stats([t for t in sel if t["strategy"] == s], s, bank)
    print()
# noise test vs corrected OOS expectation
exp_per_trade_500 = 8.88 / 191
avg_notional = st.mean(t["notional"] for t in bot)
exp_live = exp_per_trade_500 * (avg_notional / 200.0)
nets = [t["net"] for t in bot]; m = st.mean(nets); sd = st.pstdev(nets); se = sd / len(nets) ** 0.5
print(f"Noise test: corrected OOS S1+S6 expectancy = +${exp_per_trade_500:.3f}/trade at $200 notional → ${exp_live:.3f} at live avg notional ${avg_notional:.0f}. "
      f"Live mean={m:+.3f} sd={sd:.2f} n={len(nets)} se={se:.2f} → t=({m:+.3f}-{exp_live:.3f})/{se:.2f} = {(m-exp_live)/se:+.2f}")

# ---------------------------------------------------------------- AXIS 2 costs
print("\n" + "=" * 100); print("AXIS 2 — costs"); print("=" * 100)
rates = [float(f["fee"]) / (float(f["px"]) * float(f["sz"])) for f in fills]
print(f"fills since W1: {len(fills)}; fee/notional mean={st.mean(rates)*1e4:.2f} bps min={min(rates)*1e4:.2f} max={max(rates)*1e4:.2f}; crossed(taker)={sum(1 for f in fills if f['crossed'])}/{len(fills)}; fee tokens={Counter(f.get('feeToken') for f in fills)}")
fe = hl["fees"]; print(f"userFees now: userCrossRate={fe['userCrossRate']} userAddRate={fe['userAddRate']} referralDiscount={fe.get('activeReferralDiscount')} staking={fe.get('activeStakingDiscount')} 14d volume rows={len(fe['dailyUserVlm'])} sum userCross={sum(float(d['userCross']) for d in fe['dailyUserVlm']):.0f}")
fund = [x for x in hl["funding"] if x["time"] >= W1]
pos = sum(float(x["delta"]["usdc"]) for x in fund if float(x["delta"]["usdc"]) > 0); neg = sum(float(x["delta"]["usdc"]) for x in fund if float(x["delta"]["usdc"]) < 0)
print(f"funding events since W1: {len(fund)} received={pos:+.4f} paid={neg:+.4f} net={pos+neg:+.4f}; per bot trip mean={st.mean(t['funding'] for t in bot):+.4f}; hours with position={len(fund)}")
gross_abs = sum(abs(t["gross"]) for t in bot); fees_tot = sum(t["fees"] for t in bot); gw = sum(t["gross"] for t in bot if t["gross"] > 0)
print(f"bot trips: gross={sum(t['gross'] for t in bot):+.2f} gross wins={gw:.2f} fees={fees_tot:.2f} funding={sum(t['funding'] for t in bot):+.3f} → fees/|gross| = {fees_tot/gross_abs*100:.1f}%, fees/gross-wins = {fees_tot/gw*100:.1f}%, (fees-funding)/notional-turnover = {(fees_tot - sum(t['funding'] for t in bot))/sum(t['notional']*2 for t in bot)*1e4:.2f} bps per side-equivalent")
print(f"avg notional per trip ${avg_notional:.2f}; avg fee per trip ${fees_tot/len(bot):.3f}; round-trip cost at 4.5bps×2 = {avg_notional*0.0009:.3f}")

# ---------------------------------------------------------------- AXIS 3 slippage/timing
print("\n" + "=" * 100); print("AXIS 3 — slippage & timing"); print("=" * 100)
snaps = L["snaps"]
def snap_before(tms, win=120_000):
    c = [s for s in snaps if tms - win <= pms(s["taken_at"]) <= tms]
    return c[-1]["price"] if c else None
c15map = {c["t"]: float(c["c"]) for c in C15}
ent_mark, ent_snap, ent_c15, ent_lat = [], [], [], []
for tr in bot:
    sgn = 1 if tr["dir"] == "long" else -1
    if tr["mark_px"]: ent_mark.append((tr["entry_px"] - tr["mark_px"]) / tr["mark_px"] * 1e4 * sgn)
    sp = snap_before(tr["t0"])
    if sp: ent_snap.append((tr["entry_px"] - sp) / sp * 1e4 * sgn)
    bar = (tr["t0"] // B15) * B15 - B15
    if bar in c15map: ent_c15.append((tr["entry_px"] - c15map[bar]) / c15map[bar] * 1e4 * sgn)
    ent_lat.append((tr["t0"] % B15) / 1000)
def dist(lab, xs): print(f"{lab}: n={len(xs)} mean={st.mean(xs):+.2f} median={st.median(xs):+.2f} p90={q(xs,0.9):+.2f} max={max(xs):+.2f} min={min(xs):+.2f}") if xs else print(f"{lab}: n=0")
dist("entry slippage vs bot mark px (bps, +=cost)", ent_mark)
dist("entry slippage vs market_snapshots close (bps)", ent_snap)
dist("entry fill vs HL 15m close of triggering bar (bps, from 09-12 only)", ent_c15)
dist("entry latency: seconds after 15m bar boundary", ent_lat)
bot_exits = [t for t in bot if t["exit_reason"] in ("ema_reverse_cross", "bbwp_cycle_complete")]
ex_lat = [(t["t1"] % B15) / 1000 for t in bot_exits]; ex_snap = []
for tr in bot_exits:
    sgn = -1 if tr["dir"] == "long" else 1  # selling to exit long: cost if fill < ref
    sp = snap_before(tr["t1"])
    if sp: ex_snap.append((tr["exit_px"] - sp) / sp * 1e4 * sgn)
dist("bot-initiated exit slippage vs snapshot close (bps, +=cost)", ex_snap)
dist("bot-initiated exit latency: seconds after bar boundary", ex_lat)
stops = [t for t in bot if t["exit_reason"] == "native_sl" and t["last_trigger"]]
stop_slip = []
for tr in stops:
    cost = (tr["last_trigger"] - tr["exit_px"]) if tr["dir"] == "long" else (tr["exit_px"] - tr["last_trigger"])
    stop_slip.append(cost / tr["last_trigger"] * 1e4)
    print(f"   stop {iso(tr['t1'])} {tr['strategy']} {tr['dir']} trigger={tr['last_trigger']} fill={tr['exit_px']:.1f} slip={cost/tr['last_trigger']*1e4:+.1f}bps (${cost*tr['size']:+.3f})")
dist("stop fill vs trigger (bps, +=cost)", stop_slip)
tps = [t for t in bot if t["exit_reason"] == "native_tp"]; print(f"native_tp exits: {len(tps)}")
print(f"exit reasons: {Counter(t['exit_reason'] for t in bot)}")
print(f"$ impact of entry slippage vs mark: total {sum(x/1e4*t['notional'] for x,t in zip(ent_mark,[t for t in bot if t['mark_px']])):+.3f} over {len(ent_mark)} entries")

# ---------------------------------------------------------------- AXIS 4 participation
print("\n" + "=" * 100); print("AXIS 4 — participation"); print("=" * 100)
def union_hours(ts, a, b):
    iv = sorted([(max(t["t0"], a), min(t["t1"], b)) for t in ts if t["t1"] > a and t["t0"] < b]); tot = 0; ce = -1
    for s, e in iv:
        if e <= ce: continue
        tot += e - max(s, ce); ce = e
    return tot / H
for lab, a, b in (("W1 full 08-20→now", W1, NOW), ("W1 until wallet death 08-20→10-18 09:45", W1, DEAD), ("W2 09-23→now", W2, NOW), ("W2 until death", W2, DEAD)):
    hb = union_hours(bot, a, b); ha = union_hours(trips, a, b); tot = (b - a) / H
    print(f"{lab}: {tot:.0f}h total; bot in position {hb:.0f}h = {hb/tot*100:.1f}%; incl. manual {ha:.0f}h = {ha/tot*100:.1f}%")
c1h = sorted(hl["c1h"], key=lambda c: c["t"]); closes = [(c["t"], float(c["c"])) for c in c1h]
flag = []
for i in range(24, len(closes)):
    r = closes[i][1] / closes[i - 24][1] - 1
    if abs(r) > 0.03 and closes[i][0] >= W1: flag.append((closes[i][0], r))
eps = []
for t, r in flag:
    if eps and t - eps[-1]["end"] <= H and (r > 0) == (eps[-1]["peak"] > 0):
        eps[-1]["end"] = t; eps[-1]["peak"] = max(eps[-1]["peak"], r, key=abs)
    else: eps.append({"start": t, "end": t, "peak": r})
print(f"\nBTC |24h move| > 3% episodes since W1 (HL 1h closes, hours flagged={len(flag)}, episodes={len(eps)}):")
sig_lines = [(pms(r["ts"]), r["message"]) for r in L["s6d"] if "SIGNAL" in r["message"]] + [(pms(r["ts"]), r["message"]) for r in L["s1d"] if "cross=LONG" in r["message"] or "cross=SHORT" in r["message"]]
aligned = against = flat = 0; pnl_in = 0
for e in eps:
    w0, w1 = e["start"] - 24 * H, e["end"] + H
    ov = [t for t in bot if t["t1"] > w0 and t["t0"] < w1]
    sign = "UP" if e["peak"] > 0 else "DOWN"
    status = []
    for t in ov:
        al = (t["dir"] == "long") == (e["peak"] > 0); status.append(f"{t['strategy']} {t['dir']} {'ALIGNED' if al else 'AGAINST'} net={t['net']:+.2f}")
        pnl_in += t["net"]
        if al: aligned += 1
        else: against += 1
    if not ov: flat += 1
    sigs = [m[:40] for tm, m in sig_lines if w0 <= tm <= w1]
    print(f"  {iso(e['start'])}→{iso(e['end'])} {sign} peak24h={e['peak']*100:+.1f}% | trades={'; '.join(status) or 'FLAT'} | signals in window={len(sigs)} {'(post-death, unexecuted)' if e['start']>DEAD else ''}")
print(f"episodes={len(eps)} flat={flat} trades aligned={aligned} against={against} net PnL of overlapping trades={pnl_in:+.2f}")

# post-death signals
print("\nSignals after wallet death (no order possible):")
post = [(pms(r["ts"]), r["message"]) for r in L["botvps"] if pms(r["ts"]) > DEAD and re.search(r"S6 (long|short) signal", r["message"])]
hmap = dict(closes)
def close_at(tms):
    k = (tms // H) * H
    return hmap.get(k) or hmap.get(k - H)
rets = []
for tm, m in post:
    d = re.search(r"S6 (long|short)", m).group(1); c0 = close_at(tm); c24 = hmap.get((tm // H) * H + 24 * H)
    if c0 and c24: r = (c24 / c0 - 1) * (1 if d == "long" else -1); rets.append(r); print(f"   {iso(tm)} {d} 24h paper move in favour={r*100:+.2f}%")
print(f"   n={len(post)} mean 24h move in favour={st.mean(rets)*100:+.2f}% (paper, ignores stops/exits — colour only)")

# ---------------------------------------------------------------- AXIS 6 cascade
print("\n" + "=" * 100); print("AXIS 6 — cascade heartbeats (new format only, since 2026-09-24T06:11Z)"); print("=" * 100)
hb = []
for r in L["webhook"]:
    m = re.search(r"severity=(\w+) impact=\$([\d.]+)M debt=\$([\d.]+)M imminent=(\d+) chains=(\S+)", r["message"])
    if m and "debt=" in r["message"]:
        hb.append({"t": pms(r["ts"]), "sev": m.group(1), "impact": float(m.group(2)), "debt": float(m.group(3)), "imm": int(m.group(4)), "chains": m.group(5)})
old = [r for r in L["webhook"] if "Cascade received" in r["message"] and "debt=" not in r["message"]]
print(f"heartbeats new-format={len(hb)} ({iso(hb[0]['t'])}→{iso(hb[-1]['t'])}); old-format (excluded)={len(old)}; rejected/other webhook rows={sum(1 for r in L['webhook'] if 'Cascade received' not in r['message'])}")
print(f"severity={Counter(h['sev'] for h in hb)} chains={Counter(h['chains'] for h in hb)}")
gaps = [(hb[i]["t"] - hb[i - 1]["t"]) / 60000 for i in range(1, len(hb))]
print(f"cadence: median gap={st.median(gaps):.1f}min p90={q(gaps,0.9):.0f}min max={max(gaps):.0f}min; days covered={len({iso(h['t'])[:10] for h in hb})}")
for k in ("impact", "debt", "imm"):
    xs = [h[k] for h in hb]
    print(f"{k}: min={min(xs)} p10={q(xs,.1):.2f} p25={q(xs,.25):.2f} median={st.median(xs):.2f} p75={q(xs,.75):.2f} p90={q(xs,.9):.2f} max={max(xs)} nonzero={sum(1 for x in xs if x>0)} distinct={len(set(xs))}")
print("plausible 'large' definitions met:", {
    "impact>=1M": sum(1 for h in hb if h["impact"] >= 1), "impact>=10M": sum(1 for h in hb if h["impact"] >= 10), "impact>=50M": sum(1 for h in hb if h["impact"] >= 50),
    "debt>=100M": sum(1 for h in hb if h["debt"] >= 100), "debt>=200M": sum(1 for h in hb if h["debt"] >= 200), "debt>=500M": sum(1 for h in hb if h["debt"] >= 500),
    "imminent>=20": sum(1 for h in hb if h["imm"] >= 20), "imminent>=50": sum(1 for h in hb if h["imm"] >= 50), "severity high/critical": sum(1 for h in hb if h["sev"] != "medium")})
print("distinct (impact,debt-rounded-to-1M,imm) tuples:", len({(h["impact"], round(h["debt"]), h["imm"]) for h in hb}))
# exploratory forward returns, IN-SAMPLE
def fwd(h, hours):
    k = (h["t"] // H) * H; c0 = hmap.get(k - H); c1 = hmap.get(k - H + hours * H)
    return (c1 / c0 - 1) * 100 if c0 and c1 else None
for key in ("impact", "debt", "imm"):
    xs = [h[key] for h in hb]; thr = q(xs, 0.9)
    top = [h for h in hb if h[key] >= thr and thr > 0]; rest = [h for h in hb if not (h[key] >= thr and thr > 0)]
    if not top: print(f"top-decile by {key}: threshold {thr} → no usable split (all zero?)"); continue
    print(f"top-decile by {key} (>= {thr:.2f}): n={len(top)} vs rest n={len(rest)} [IN-SAMPLE, exploratory, overlapping hourly samples]")
    for hrs in (1, 4, 24):
        a = [x for x in (fwd(h, hrs) for h in top) if x is not None]; b = [x for x in (fwd(h, hrs) for h in rest) if x is not None]
        print(f"   +{hrs:>2}h: top mean={st.mean(a):+.3f}% median={st.median(a):+.3f}% %down={sum(1 for x in a if x<0)/len(a)*100:.0f}% | rest mean={st.mean(b):+.3f}% median={st.median(b):+.3f}% %down={sum(1 for x in b if x<0)/len(b)*100:.0f}%")
# base rates
allr = [x for x in (fwd(h, 24) for h in hb) if x is not None]
print(f"unconditional 24h return over heartbeat hours: mean={st.mean(allr):+.3f}% sd={st.pstdev(allr):.2f}% (n={len(allr)})")
