/**
 * MCP client wrapper for the tradingview-mcp server.
 *
 * Spawns the tradingview-mcp server as a child process and communicates with
 * it over stdio using the official @modelcontextprotocol/sdk client.
 *
 * The tradingview-mcp server itself connects to TradingView Desktop via
 * Chrome DevTools Protocol (port 9222) — TradingView must be launched with
 * the --remote-debugging-port=9222 flag (use launch_tradingview.ps1).
 *
 * Multiple CDP clients to TradingView are allowed, so it's fine for both
 * Claude Desktop and the bot to be connected at the same time.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TRADINGVIEW_MCP_PATH =
  "C:\\Users\\cryptomeda\\Desktop\\Swarm\\myprojects\\tradingview-mcp\\src\\server.js";

export class TradingViewMCP {
  private client: Client;
  private transport: StdioClientTransport;
  private connected = false;

  constructor() {
    this.transport = new StdioClientTransport({
      command: "node",
      args: [TRADINGVIEW_MCP_PATH],
    });
    this.client = new Client(
      { name: "trading-bot", version: "1.0.0" },
      { capabilities: {} }
    );
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect(this.transport);
    this.connected = true;
    console.log("[MCP] Connected to tradingview-mcp server");
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
  }

  /**
   * Calls a tool on the tradingview-mcp server. Returns the parsed JSON
   * payload from the tool's text content (the server returns JSON-as-text).
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.connected) await this.connect();
    const result = await this.client.callTool({ name, arguments: args });

    // tradingview-mcp returns content as [{ type: "text", text: "<json>" }]
    const content = result.content as Array<{ type: string; text?: string }> | undefined;
    if (!content || content.length === 0) return null;
    const first = content[0];
    if (first.type !== "text" || !first.text) return null;
    try {
      return JSON.parse(first.text);
    } catch {
      return first.text;
    }
  }
}
