/**
 * Webhook server — receives external signals via HTTP POST.
 *
 * Uses Node built-in http module (no Express dependency).
 * Single endpoint: POST /webhook/cascade
 * Auth: Bearer token in Authorization header (S5_WEBHOOK_SECRET).
 */

import * as http from "http";
import { receiveCascadeSignal, type CascadeSignal, type CascadeSeverity } from "../strategy/s5_cascade";
import { sendDiscord, Colors } from "../notifications/discord";

const VALID_SEVERITIES = new Set<CascadeSeverity>(["medium", "high", "critical"]);

let cascadeHeartbeatCount = 0;
let lastHeartbeatAt = 0;

export function getCascadeHeartbeatStatus(): { count: number; lastAt: number } {
  return { count: cascadeHeartbeatCount, lastAt: lastHeartbeatAt };
}

export function resetCascadeHeartbeatCount(): void {
  cascadeHeartbeatCount = 0;
}

interface WebhookConfig {
  port: number;
  secret: string;
}

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 64 * 1024; // 64KB limit

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error("Body too large"));
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function handleCascade(body: string): { ok: boolean; signal?: CascadeSignal; error?: string } {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }

  const severity = parsed.severity as string;
  if (!severity || !VALID_SEVERITIES.has(severity as CascadeSeverity)) {
    return { ok: false, error: `Invalid severity: ${severity}. Must be medium|high|critical` };
  }

  const estimatedImpactUsd = Number(parsed.estimated_impact_usd ?? parsed.estimatedImpactUsd ?? 0);
  const imminentCount = Number(parsed.imminent_count ?? parsed.imminentCount ?? 0);
  const aggregateDebtUsd = Number(parsed.aggregate_debt_usd ?? parsed.aggregateDebtUsd ?? 0);
  const chains = Array.isArray(parsed.chains) ? (parsed.chains as string[]) : [];

  const signal: CascadeSignal = {
    severity: severity as CascadeSeverity,
    estimatedImpactUsd,
    chains,
    imminentCount,
    aggregateDebtUsd,
    receivedAt: Date.now(),
    sourceTimestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : undefined,
  };

  receiveCascadeSignal(signal);
  return { ok: true, signal };
}

export function startWebhookServer(config: WebhookConfig): http.Server {
  const server = http.createServer(async (req, res) => {
    // Health check
    if (req.method === "GET" && req.url === "/health") {
      json(res, 200, { status: "ok", timestamp: new Date().toISOString() });
      return;
    }

    // Only POST /webhook/cascade
    if (req.method !== "POST" || req.url !== "/webhook/cascade") {
      json(res, 404, { error: "Not found" });
      return;
    }

    // Auth check
    const authHeader = req.headers.authorization ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (token !== config.secret) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }

    try {
      const body = await parseBody(req);
      const result = handleCascade(body);

      if (!result.ok) {
        console.log(`[Webhook] Rejected cascade: ${result.error}`);
        json(res, 400, { error: result.error });
        return;
      }

      const sig = result.signal!;
      console.log(
        `[Webhook] Cascade received: severity=${sig.severity} ` +
        `impact=$${(sig.estimatedImpactUsd / 1e6).toFixed(0)}M ` +
        `imminent=${sig.imminentCount} chains=${sig.chains.join(",") || "unknown"}`,
      );
      cascadeHeartbeatCount++;
      lastHeartbeatAt = Date.now();

      if (sig.severity === "high" || sig.severity === "critical") {
        sendDiscord("signals",
          `CASCADE SIGNAL — ${sig.severity.toUpperCase()}\n` +
          `Impact: $${(sig.estimatedImpactUsd / 1e6).toFixed(0)}M | ` +
          `Imminent: ${sig.imminentCount} positions\n` +
          `Chains: ${sig.chains.join(", ") || "unknown"}\n` +
          `SHORT entry will evaluate on next bar close`,
          Colors.red,
        );
      }

      json(res, 200, { accepted: true, severity: sig.severity, receivedAt: sig.receivedAt });
    } catch (err) {
      console.error("[Webhook] Error:", err);
      json(res, 500, { error: "Internal server error" });
    }
  });

  server.listen(config.port, () => {
    console.log(`[Webhook] Listening on port ${config.port}`);
  });

  return server;
}
