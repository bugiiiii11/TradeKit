/**
 * One-off: move the live BTC reduce-only stop-loss to a new trigger price.
 *
 * WHY: trailing is stuck on the open S1 SHORT (modifyStopLoss targets a stale
 * oid → "Cannot modify canceled or filled order" every bar). The resting stop
 * is frozen at $63,249 — above entry, so it protects nothing on a now-profitable
 * short. This manually re-trails it to lock in profit. Stopgap for the proper
 * fix (capture the reassigned oid from modify()).
 *
 * SAFETY:
 *   - Dry-run by default. Pass --confirm to actually place the modify.
 *   - Hard-asserts the wallet is the VPS master (0x5642...4110). Aborts otherwise,
 *     so it can never act on the desktop account by mistake.
 *   - Finds the live stop by querying openOrders (reduce-only BTC) — does NOT
 *     trust any stored oid. Aborts unless exactly one such order exists.
 *   - Single atomic modify(): the position is never naked (no cancel-then-place).
 *
 * USAGE (run ON the VPS, where .env has the VPS agent wallet):
 *   npx ts-node src/scripts/move_s1_sl.ts --price 60650            # dry-run
 *   npx ts-node src/scripts/move_s1_sl.ts --price 60650 --confirm  # execute
 *
 * If --price is omitted, defaults to 2% above current mark (matches the bot's
 * TRAILING_DISTANCE=0.02 for a short).
 */

import "dotenv/config";
import { getHyperliquidContext } from "../hyperliquid/client";

const VPS_MASTER = "0x5642A41938903483486085D3672535e3a7044110".toLowerCase();
const TRAILING_DISTANCE = 0.02; // matches VPS .env

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const CONFIRM = process.argv.includes("--confirm");

async function main() {
  const ctx = await getHyperliquidContext();

  // 1. Wallet guard — must be the VPS account.
  if (ctx.masterAddress.toLowerCase() !== VPS_MASTER) {
    throw new Error(
      `Refusing to run: master is ${ctx.masterAddress}, expected VPS ${VPS_MASTER}. ` +
        `This script must run on the VPS with the VPS .env.`
    );
  }

  // 2. Position must be the open BTC SHORT.
  const state = await ctx.info.clearinghouseState({ user: ctx.masterAddress });
  const pos = state.assetPositions.find((p) => p.position.coin === "BTC");
  const szi = pos ? parseFloat(pos.position.szi) : 0;
  if (!pos || szi === 0) throw new Error("No open BTC position — nothing to protect.");
  if (szi > 0) throw new Error(`Position is LONG (szi=${szi}); this script is for the SHORT. Aborting.`);
  const sizeBase = Math.abs(szi);
  const entry = parseFloat(pos.position.entryPx);
  const uPnl = parseFloat(pos.position.unrealizedPnl);

  // 3. Current mark + the live resting stop.
  const [, ctxs] = await ctx.info.metaAndAssetCtxs();
  const mark = parseFloat(ctxs[ctx.btcAssetIndex].markPx);

  const open = await ctx.info.openOrders({ user: ctx.masterAddress });
  const stops = open.filter(
    (o: { coin?: string; reduceOnly?: boolean }) => o.coin === "BTC" && o.reduceOnly === true
  );
  if (stops.length !== 1) {
    throw new Error(
      `Expected exactly 1 reduce-only BTC stop, found ${stops.length}: ` +
        JSON.stringify(stops.map((s: any) => ({ oid: s.oid, px: s.limitPx })))
    );
  }
  const liveOid: number = (stops[0] as any).oid;
  const curStop = parseFloat((stops[0] as any).limitPx);

  // 4. Target price: explicit --price, else 2% above mark (short trailing).
  const target = arg("price") ? parseFloat(arg("price")!) : Math.round(mark * (1 + TRAILING_DISTANCE));

  // Sanity: for a SHORT, a profit-locking stop must be BELOW entry and ABOVE mark.
  const lockedPnl = (entry - target) * sizeBase;
  console.log("\n──────── S1 SHORT — manual SL re-trail ────────");
  console.log(`Wallet (VPS master): ${ctx.masterAddress}`);
  console.log(`Position: SHORT ${sizeBase} BTC | entry $${entry} | mark $${mark} | uPnL $${uPnl.toFixed(2)}`);
  console.log(`Live resting stop: oid=${liveOid} @ $${curStop}  (frozen — bot can't trail it)`);
  console.log(`New stop trigger:  $${target}`);
  console.log(`  → distance from mark: ${(((target - mark) / mark) * 100).toFixed(2)}% above`);
  console.log(`  → locks PnL if hit:  $${lockedPnl.toFixed(2)} (${target < entry ? "PROFIT" : "loss"})`);

  // Guard rails.
  if (target <= mark) throw new Error(`Target $${target} is at/below mark $${mark} — would trigger instantly. Aborting.`);
  if (target >= curStop) throw new Error(`Target $${target} is not tighter than current $${curStop} (ratchet-only). Aborting.`);
  if (target >= entry) console.warn(`⚠️  Target $${target} is ABOVE entry $${entry} — this still locks a LOSS, not profit.`);

  if (!CONFIRM) {
    console.log("\nDRY-RUN (no --confirm). Re-run with --confirm to place the modify.\n");
    return;
  }

  // 5. Atomic modify of the live order.
  await ctx.exchange.modify({
    oid: liveOid,
    order: {
      a: ctx.btcAssetIndex,
      b: true, // buy-stop closes a short
      p: String(target),
      s: pos.position.szi.replace("-", ""), // exact resting size, string
      r: true,
      t: { trigger: { isMarket: true, triggerPx: String(target), tpsl: "sl" as const } },
    },
  });

  // 6. Verify.
  const after = (await ctx.info.openOrders({ user: ctx.masterAddress })).filter(
    (o: { coin?: string; reduceOnly?: boolean }) => o.coin === "BTC" && o.reduceOnly === true
  );
  console.log("\n✅ Modify sent. Resting reduce-only BTC stops now:");
  after.forEach((o: any) => console.log(`   oid=${o.oid} @ $${o.limitPx}`));
  console.log("");
}

main().catch((e) => {
  console.error("\n❌ Failed:", e.message ?? e);
  process.exit(1);
});
