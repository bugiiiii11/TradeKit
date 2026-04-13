/**
 * TradingView MCP discovery script — READ-ONLY.
 *
 * Dumps the raw response shapes from the TradingView MCP server so we can
 * write a proper indicator-snapshot parser based on what the chart actually
 * returns. This is a one-shot script — once we know the data shape, we
 * write the real reader and don't need this anymore.
 *
 * Run with: npx ts-node src/scripts/discover_tradingview.ts
 */

import { TradingViewMCP } from "../mcp/client";

async function main(): Promise<void> {
  const mcp = new TradingViewMCP();
  await mcp.connect();

  console.log("\n========== tv_health_check ==========");
  const health = await mcp.callTool("tv_health_check");
  console.log(JSON.stringify(health, null, 2));

  console.log("\n========== chart_get_state ==========");
  const state = await mcp.callTool("chart_get_state");
  console.log(JSON.stringify(state, null, 2));

  console.log("\n========== data_get_study_values (current timeframe) ==========");
  const values = await mcp.callTool("data_get_study_values");
  console.log(JSON.stringify(values, null, 2));

  console.log("\n========== quote_get ==========");
  const quote = await mcp.callTool("quote_get", {});
  console.log(JSON.stringify(quote, null, 2));

  await mcp.close();
  console.log("\n[Discovery] ✅ Done. Copy the output above and share it.");
}

main().catch((err) => {
  console.error("[Discovery] ❌ FAILED:", err);
  process.exit(1);
});
