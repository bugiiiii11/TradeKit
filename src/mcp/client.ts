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
 *
 * Resilience: callTool retries up to MAX_RETRIES times with exponential
 * backoff. On persistent failure it tears down the child process and spawns
 * a fresh one (reconnect). This covers TradingView restarts, CDP drops,
 * and transient child-process crashes without killing the main bot loop.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TRADINGVIEW_MCP_PATH =
  "C:\\Users\\cryptomeda\\Desktop\\Swarm\\myprojects\\tradingview-mcp\\src\\server.js";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2_000; // 2s → 4s → 8s

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class TradingViewMCP {
  private client!: Client;
  private transport!: StdioClientTransport;
  private connected = false;
  private reconnecting = false;

  constructor() {
    this.buildTransport();
  }

  /** Create a fresh transport + client pair (used on init and reconnect). */
  private buildTransport(): void {
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
    try {
      await this.client.close();
    } catch {
      // Already dead — swallow.
    }
    this.connected = false;
  }

  /**
   * Tear down the current child process and spawn a fresh one.
   * Serialized via `reconnecting` flag so concurrent callers don't race.
   */
  async reconnect(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    try {
      console.warn("[MCP] Reconnecting — tearing down old child process...");
      await this.close();
      this.buildTransport();
      await this.connect();
      console.log("[MCP] Reconnect successful");
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * Calls a tool on the tradingview-mcp server. Returns the parsed JSON
   * payload from the tool's text content (the server returns JSON-as-text).
   *
   * Retries up to MAX_RETRIES times with exponential backoff. After all
   * retries are exhausted on a single attempt, performs a full reconnect
   * (new child process) and tries once more. If that also fails, throws.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
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
      } catch (err) {
        lastError = err;
        const isLastRetry = attempt === MAX_RETRIES;

        if (isLastRetry) {
          // All retries exhausted — try a full reconnect + one final attempt.
          console.error(
            `[MCP] callTool("${name}") failed after ${MAX_RETRIES + 1} attempts. Attempting reconnect...`
          );
          try {
            await this.reconnect();
            const result = await this.client.callTool({ name, arguments: args });
            const content = result.content as Array<{ type: string; text?: string }> | undefined;
            if (!content || content.length === 0) return null;
            const first = content[0];
            if (first.type !== "text" || !first.text) return null;
            try {
              return JSON.parse(first.text);
            } catch {
              return first.text;
            }
          } catch (reconnectErr) {
            console.error("[MCP] Reconnect attempt also failed:", reconnectErr);
            throw lastError; // Throw the original error for clarity.
          }
        }

        const delay = BASE_DELAY_MS * 2 ** attempt;
        console.warn(
          `[MCP] callTool("${name}") attempt ${attempt + 1}/${MAX_RETRIES + 1} failed — ` +
            `retrying in ${delay / 1000}s...`,
          err instanceof Error ? err.message : err
        );
        await sleep(delay);
      }
    }

    // Unreachable, but satisfies TypeScript.
    throw lastError;
  }
}
