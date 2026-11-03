/**
 * Throwaway (Landscape v1, seat B). Read-only Hyperliquid info dump for the VPS master wallet.
 * Writes JSON to the path given as argv[2]. No exchange actions.
 */
const W = "0x5642A41938903483486085D3672535e3a7044110";
const API = "https://api.hyperliquid.xyz/info";
const START = Date.parse("2026-06-01T00:00:00Z"); // wide: covers pre-outage too

async function post(body: unknown): Promise<any> {
  const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
async function paged(type: string): Promise<any[]> {
  const out: any[] = [];
  let st = START;
  for (let i = 0; i < 50; i++) {
    const page: any[] = await post({ type, user: W, startTime: st });
    if (!page.length) break;
    out.push(...page);
    if (page.length < 2000) break;
    st = page[page.length - 1].time + 1;
  }
  return out;
}
(async () => {
  const fills = await paged("userFillsByTime");
  const funding = await paged("userFunding");
  const ledger = await paged("userNonFundingLedgerUpdates");
  const state = await post({ type: "clearinghouseState", user: W });
  const fees = await post({ type: "userFees", user: W });
  const l2 = await post({ type: "l2Book", coin: "BTC", nSigFigs: 5 });
  const now = Date.now();
  const c1h = await post({ type: "candleSnapshot", req: { coin: "BTC", interval: "1h", startTime: Date.parse("2026-08-15T00:00:00Z"), endTime: now } });
  const fh = await post({ type: "fundingHistory", coin: "BTC", startTime: Date.parse("2026-08-20T00:00:00Z"), endTime: now });
  const out = { fetchedAt: new Date(now).toISOString(), fills, funding, ledger, state, fees, l2, c1h, fundingHistory: fh };
  require("fs").writeFileSync(process.argv[2], JSON.stringify(out));
  console.log(`fills=${fills.length} funding=${funding.length} ledger=${ledger.length} c1h=${c1h.length} fh=${fh.length} l2 levels=${l2.levels?.[0]?.length}/${l2.levels?.[1]?.length} l2.time=${l2.time}`);
})().catch(e => { console.error(e); process.exit(1); });
