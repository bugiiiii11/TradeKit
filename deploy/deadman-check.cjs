#!/usr/bin/env node
/**
 * External dead-man's switch for the VPS bot's WebSocket bar-close loop.
 *
 * Runs from cron (NOT pm2) every 15 minutes, fully outside the bot process, so
 * it keeps working when the bot is silently wedged (S44: 7 days dead, S48: 54
 * days dead — both times pm2 said "online" and the 2h digest said "ACTIVE").
 *
 * Checks the newest `[WS] Bar closed` row in Supabase `bot_logs`. If it is
 * older than STALE_MIN, posts to the Discord errors webhook. Re-alerts every
 * REALERT_MIN while stale, posts a recovery notice when bars resume. State is
 * kept in a small JSON file so cron runs don't spam.
 *
 * Install on VPS (uses the bot's own .env for Supabase + Discord creds):
 *   crontab -e
 *   STAR/15 * * * * cd /home/ubuntu/trading-bot && /usr/bin/node --env-file=.env deploy/deadman-check.cjs >> /home/ubuntu/.pm2/logs/deadman.log 2>&1
 *   (replace STAR with *)
 *
 * Env (from .env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_WEBHOOK_ERRORS
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { createClient } = require("@supabase/supabase-js");

const STALE_MIN = parseInt(process.env.DEADMAN_STALE_MIN || "35", 10);
const REALERT_MIN = parseInt(process.env.DEADMAN_REALERT_MIN || "120", 10);
const STATE_FILE = path.join(os.homedir(), ".tradekit-deadman.json");

function nowIso() { return new Date().toISOString(); }

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return { alerting: false, lastAlertAt: 0 }; }
}
function writeState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) { console.error(`[deadman] state write failed: ${e.message}`); }
}

async function discord(content, color) {
  const url = process.env.DISCORD_WEBHOOK_ERRORS;
  if (!url) { console.error("[deadman] DISCORD_WEBHOOK_ERRORS not set — cannot alert"); return; }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "TradeKit Deadman", embeds: [{ description: content, color }] }),
    });
    if (!res.ok) console.error(`[deadman] Discord HTTP ${res.status}`);
  } catch (e) {
    console.error(`[deadman] Discord post failed: ${e.message}`);
  }
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("[deadman] Supabase env missing"); process.exit(2); }

  const sb = createClient(url, key);
  const { data, error } = await sb
    .from("bot_logs")
    .select("ts")
    .eq("source", "ws")
    .like("message", "[WS] Bar closed%")
    .order("ts", { ascending: false })
    .limit(1);

  const state = readState();
  const now = Date.now();

  if (error) {
    // Can't verify — alert once, don't spam (Supabase hiccups are not bot deaths).
    console.error(`[deadman] ${nowIso()} query failed: ${error.message}`);
    if (!state.queryFailAlerted) {
      await discord(`⚠️ Deadman cannot reach Supabase bot_logs: ${error.message}`, 0xf39c12);
      writeState({ ...state, queryFailAlerted: true });
    }
    return;
  }
  if (state.queryFailAlerted) state.queryFailAlerted = false;

  const lastTs = data && data[0] ? new Date(data[0].ts).getTime() : 0;
  const ageMin = lastTs ? (now - lastTs) / 60_000 : Infinity;
  const ageStr = Number.isFinite(ageMin) ? `${ageMin.toFixed(0)}min` : "never";

  if (ageMin > STALE_MIN) {
    const sinceLast = (now - (state.lastAlertAt || 0)) / 60_000;
    if (!state.alerting || sinceLast >= REALERT_MIN) {
      console.error(`[deadman] ${nowIso()} STALE — last bar close ${ageStr} ago — alerting`);
      await discord(
        `🚨 **VPS bot WS loop is DEAD** — last bar close **${ageStr} ago** (threshold ${STALE_MIN}min).\n` +
        `pm2 "online" does not mean alive. Check: \`tail ~/.pm2/logs/trading-bot-out.log\` and \`pm2 restart trading-bot\`.`,
        0xe74c3c,
      );
      writeState({ ...state, alerting: true, lastAlertAt: now, staleSince: state.staleSince || now });
    } else {
      console.log(`[deadman] ${nowIso()} still stale (${ageStr}), next re-alert in ${(REALERT_MIN - sinceLast).toFixed(0)}min`);
    }
    return;
  }

  if (state.alerting) {
    const downMin = state.staleSince ? ((now - state.staleSince) / 60_000).toFixed(0) : "?";
    console.log(`[deadman] ${nowIso()} RECOVERED — last bar close ${ageStr} ago`);
    await discord(`✅ VPS bot WS loop recovered — bar closes flowing again (was stale ~${downMin}min).`, 0x2ecc71);
  } else {
    console.log(`[deadman] ${nowIso()} ok — last bar close ${ageStr} ago`);
  }
  writeState({ alerting: false, lastAlertAt: state.lastAlertAt || 0, staleSince: 0, queryFailAlerted: false });
}

main().catch((e) => { console.error(`[deadman] fatal: ${e.message}`); process.exit(1); });
