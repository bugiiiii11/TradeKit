/**
 * Discord webhook notification module with per-channel queues.
 * Uses built-in fetch() -- no discord.js dependency.
 * All errors are swallowed so a Discord outage never kills the bot.
 *
 * Adapted from Flash project (liquidator-sparklend/src/notifications/discord.ts).
 */

const MIN_GAP_MS = 500;
const MAX_RETRIES = 2;

export type DiscordChannel = "trades" | "errors" | "status";

export const Colors = {
  green: 0x2ecc71,
  red: 0xe74c3c,
  orange: 0xf39c12,
  blue: 0x3498db,
  gold: 0xf1c40f,
} as const;

interface QueueItem {
  text: string;
  color: number;
}

let webhooks: Partial<Record<DiscordChannel, string>> = {};
let botName = "bot";
const queues = new Map<DiscordChannel, QueueItem[]>();
const processing = new Set<DiscordChannel>();

export function initDiscord(urls: Partial<Record<DiscordChannel, string>>, name: string): void {
  webhooks = urls;
  botName = name;
  const configured = Object.keys(urls).filter(k => urls[k as DiscordChannel]);
  if (configured.length > 0) {
    console.log(`[Discord] Initialized: ${configured.join(", ")} channels`);
  }
}

export function sendDiscord(channel: DiscordChannel, text: string, color: number = Colors.blue): void {
  const url = webhooks[channel];
  if (!url) return;
  if (!queues.has(channel)) queues.set(channel, []);
  queues.get(channel)!.push({ text, color });
  void processQueue(channel);
}

function buildEmbed(text: string, color: number): {
  title: string;
  description?: string;
  color: number;
  footer: { text: string };
  timestamp: string;
} {
  const lines = text.split("\n").filter(l => l.length > 0);
  const title = (lines[0] ?? "Notification").slice(0, 256);
  const description = lines.length > 1 ? lines.slice(1).join("\n").slice(0, 4096) : undefined;
  return {
    title,
    ...(description ? { description } : {}),
    color,
    footer: { text: botName },
    timestamp: new Date().toISOString(),
  };
}

async function processQueue(channel: DiscordChannel): Promise<void> {
  if (processing.has(channel)) return;
  processing.add(channel);

  const q = queues.get(channel)!;
  while (q.length > 0) {
    const item = q.shift()!;
    const url = webhooks[channel];
    if (url) {
      await sendOne(url, {
        username: botName,
        embeds: [buildEmbed(item.text, item.color)],
      });
    }
    if (q.length > 0) await sleep(MIN_GAP_MS);
  }

  processing.delete(channel);
}

async function sendOne(url: string, payload: object): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok || res.status === 204) return;

      if (res.status === 429) {
        const body = await res.json().catch(() => ({})) as { retry_after?: number };
        const retryAfter = body?.retry_after ?? 1;
        await sleep(retryAfter * 1000);
        continue;
      }

      return;
    } catch {
      return;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
