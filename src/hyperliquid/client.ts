/**
 * Hyperliquid client singleton
 *
 * Wires up:
 *   - InfoClient   — read-only queries (balances, positions, funding, market meta)
 *   - ExchangeClient — signed trading actions (orders, cancels, leverage updates)
 *
 * The ExchangeClient is signed by the API wallet (agent key) created via
 * app.hyperliquid.xyz → API tab. This key can place/cancel orders and update
 * leverage on the master account but CANNOT withdraw funds.
 *
 * The master account address (HYPERLIQUID_WALLET_ADDRESS) is used for:
 *   - InfoClient queries (clearinghouseState, openOrders) which require the
 *     account address explicitly
 *   - Resolving the BTC asset index from the perp universe metadata
 */

import * as hl from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

export interface HyperliquidContext {
  info: hl.InfoClient;
  exchange: hl.ExchangeClient;
  /** The master account address — what InfoClient queries reference. */
  masterAddress: Hex;
  /** Resolved asset index for BTC perp (varies between mainnet and testnet). */
  btcAssetIndex: number;
  /** szDecimals for BTC — required to round order sizes correctly. */
  btcSzDecimals: number;
  /** true if connected to testnet, false for mainnet. */
  isTestnet: boolean;
}

let cached: HyperliquidContext | null = null;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/**
 * Builds (and caches) the Hyperliquid context. Resolves the BTC asset index
 * by scanning the perp universe metadata so we work on either mainnet or
 * testnet without hardcoding indexes.
 */
export async function getHyperliquidContext(): Promise<HyperliquidContext> {
  if (cached) return cached;

  const apiKey = requireEnv("HYPERLIQUID_PRIVATE_KEY") as Hex;
  const masterAddress = requireEnv("HYPERLIQUID_WALLET_ADDRESS") as Hex;
  const network = (process.env.HYPERLIQUID_NETWORK ?? "mainnet").toLowerCase();
  const isTestnet = network === "testnet";

  if (!apiKey.startsWith("0x") || apiKey.length !== 66) {
    throw new Error("HYPERLIQUID_PRIVATE_KEY must be a 0x-prefixed 64-char hex string");
  }
  if (!masterAddress.startsWith("0x") || masterAddress.length !== 42) {
    throw new Error("HYPERLIQUID_WALLET_ADDRESS must be a 0x-prefixed 40-char hex string");
  }

  const wallet = privateKeyToAccount(apiKey);
  const transport = new hl.HttpTransport({ isTestnet });
  const info = new hl.InfoClient({ transport });
  const exchange = new hl.ExchangeClient({ wallet, transport, isTestnet });

  // Resolve BTC asset index from the perp universe metadata.
  const [meta] = await info.metaAndAssetCtxs();
  const btcIdx = meta.universe.findIndex((u) => u.name === "BTC");
  if (btcIdx < 0) {
    throw new Error("BTC perp not found in Hyperliquid universe");
  }
  const btcSzDecimals = meta.universe[btcIdx].szDecimals;

  cached = {
    info,
    exchange,
    masterAddress,
    btcAssetIndex: btcIdx,
    btcSzDecimals,
    isTestnet,
  };

  console.log(
    `[Hyperliquid] Connected to ${isTestnet ? "TESTNET" : "MAINNET"} | ` +
      `BTC index=${btcIdx} szDecimals=${btcSzDecimals} | ` +
      `agent=${wallet.address} master=${masterAddress}`
  );

  return cached;
}
