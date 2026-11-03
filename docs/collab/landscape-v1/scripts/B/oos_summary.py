"""
Throwaway (Landscape v1, seat B, Round 2). Summarise bt_oos_trades.ts dumps: fee totals and PF at three fee
levels (linear re-pricing of the 0.00045 taker fee per trade, compounding ignored), S1 long/short time in
market and funding charged, Hyperliquid-funding rerun, and seat A's basket gate.
Run: python -I -X utf8 oos_summary.py <scratch_dir>
"""
import json, sys, os, statistics as st, datetime as dt
SC = sys.argv[1].rstrip("/\\") + "/"
H = 3600_000
def load(n): p = SC + n; return json.load(open(p)) if os.path.exists(p) else None
def repf(trades, fee):
    adj = [t["pnl"] + t["n"] * 2 * (0.00045 - fee) for t in trades]
    w = sum(x for x in adj if x > 0); l = -sum(x for x in adj if x <= 0)
    return (w / l if l else float("inf")), sum(adj), len(adj)
def dd(trades, base=500.0):
    cum = base; peak = base; worst = 0
    for t in sorted(trades, key=lambda t: t["x"]):
        cum += t["pnl"]; peak = max(peak, cum); worst = min(worst, (cum - peak) / peak)
    return -worst * 100
runs = {k: load(f"oos_{k}.json") for k in ("btc", "btc_hlfund", "eth", "sol", "xrp")}
print("=" * 100); print("TAG 1 — fee totals and PF at taker 0.00045 / 0.00015 / 0 (per config, per window; $500 bankroll each window)"); print("=" * 100)
for k in ("btc", "eth", "sol", "xrp"):
    r = runs[k]
    if not r: print(k, "missing"); continue
    for w in ("train", "test"):
        W = r["windows"][w]
        for setn, S in W["sets"].items():
            tr = S["trades"]; fees = sum(t["n"] * 0.0009 for t in tr); fund = sum(t["f"] for t in tr)
            p45, pnl45, n = repf(tr, 0.00045); p15, pnl15, _ = repf(tr, 0.00015); p0, pnl0, _ = repf(tr, 0)
            print(f"{k.upper():4} {w:5} {W['from']}..{W['to']} ({W['days']}d) {setn:6}: n={n:4} pnl={pnl45:+8.2f} PF={p45:.2f} DD={S['stats']['maxDDPct']:.1f}% | fees={fees:6.2f} funding={fund:+6.2f} | @maker PF={p15:.2f} pnl={pnl15:+8.2f} | @zero PF={p0:.2f} pnl={pnl0:+8.2f}")
print("\n" + "=" * 100); print("TAG 2 — S1 time in market long vs short, funding charged, and Hyperliquid-funding rerun (BTC)"); print("=" * 100)
for k in ("btc", "btc_hlfund"):
    r = runs[k]
    if not r: print(k, "missing"); continue
    for w in ("train", "test"):
        for setn in ("S1", "S6", "S1+S6"):
            S = r["windows"][w]["sets"][setn]; tr = S["trades"]
            lh = sum((t["x"] - t["e"]) / H for t in tr if t["d"] == "long"); sh = sum((t["x"] - t["e"]) / H for t in tr if t["d"] == "short")
            fl = sum(t["f"] for t in tr if t["d"] == "long"); fs = sum(t["f"] for t in tr if t["d"] == "short")
            print(f"{k:10} {w:5} {setn:6}: n={len(tr):4} pnl={S['stats']['pnl']:+8.2f} PF={S['stats']['pf']:.2f} | long {lh:6.0f}h funding {fl:+6.2f} | short {sh:6.0f}h funding {fs:+6.2f} | total funding {fl+fs:+6.2f} (engine sign: + = cost)")
print("\n" + "=" * 100); print("A2 gate — unchanged S1 on ETH / SOL / XRP, both windows; pooled test basket"); print("=" * 100)
passing = []
for k in ("eth", "sol", "xrp"):
    r = runs[k]
    if not r: print(k, "missing"); continue
    a = r["windows"]["train"]["sets"]["S1"]["stats"]; b = r["windows"]["test"]["sets"]["S1"]["stats"]
    ok = a["pf"] >= 1.2 and b["pf"] >= 1.2
    print(f"{k.upper()} S1: train n={a['n']} PF={a['pf']:.2f} pnl={a['pnl']:+.2f} DD={a['maxDDPct']:.1f}% | test n={b['n']} PF={b['pf']:.2f} pnl={b['pnl']:+.2f} DD={b['maxDDPct']:.1f}% → {'PASS' if ok else 'fail'} (PF>=1.2 both windows)")
    s6a = r["windows"]["train"]["sets"]["S6"]["stats"]; s6b = r["windows"]["test"]["sets"]["S6"]["stats"]
    print(f"{k.upper()} S6: train n={s6a['n']} PF={s6a['pf']:.2f} pnl={s6a['pnl']:+.2f} | test n={s6b['n']} PF={s6b['pf']:.2f} pnl={s6b['pnl']:+.2f}")
    if ok: passing.append(k)
for label, keys in (("BTC+passing alts", ["btc"] + passing), ("BTC+ETH+SOL+XRP (all)", ["btc", "eth", "sol", "xrp"])):
    pooled = [t for k in keys if runs.get(k) for t in runs[k]["windows"]["test"]["sets"]["S1"]["trades"]]
    if pooled:
        pf, pnl, n = repf(pooled, 0.00045)
        print(f"pooled TEST S1 {label} ({'+'.join(keys)}): n={n} PF={pf:.2f} pnl={pnl:+.2f} DD(seq, $500 base)={dd(pooled):.1f}% → gate PF>=1.2 & n>=40 & DD<=15%: {'PASS' if pf >= 1.2 and n >= 40 and dd(pooled) <= 15 else 'fail'}")
    pooled_tr = [t for k in keys if runs.get(k) for t in runs[k]["windows"]["train"]["sets"]["S1"]["trades"]]
    if pooled_tr:
        pf, pnl, n = repf(pooled_tr, 0.00045); print(f"pooled TRAIN S1 {label}: n={n} PF={pf:.2f} pnl={pnl:+.2f}")
