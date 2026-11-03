#!/usr/bin/env node
// One-off: generate a new Hyperliquid API-wallet (agent) key ON THE VPS and
// write it straight into .env. The private key is never printed — only the
// public address, which the master-wallet owner then approves in the
// Hyperliquid UI (API page → enter address, do NOT click Generate).
//
// Run from the repo root, in your own ssh window:
//   node deploy/new-agent-key.cjs              # writes ./.env
//   node deploy/new-agent-key.cjs --dry-run    # shows what it would do, writes nothing
//   node deploy/new-agent-key.cjs --env PATH   # different env file (testing)
//
// It does not restart the bot: the running process keeps its old key until
// `pm2 restart trading-bot`.

const fs = require("fs");
const path = require("path");
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");

const VAR = "HYPERLIQUID_PRIVATE_KEY";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const envIdx = args.indexOf("--env");
const envPath = path.resolve(envIdx >= 0 ? args[envIdx + 1] : ".env");

function fail(msg) {
  console.error(`ERROR: ${msg}\nNothing was changed.`);
  process.exit(1);
}

if (!fs.existsSync(envPath)) fail(`${envPath} not found — run from the repo root.`);

const original = fs.readFileSync(envPath, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
const lines = original.split(/\r?\n/);
const re = new RegExp(`^\\s*(export\\s+)?${VAR}\\s*=`);
const hits = lines.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);
if (hits.length !== 1) fail(`expected exactly 1 ${VAR}= line in ${envPath}, found ${hits.length}.`);

const key = generatePrivateKey();
const address = privateKeyToAccount(key).address;
lines[hits[0]] = `${VAR}=${key}`;

if (dryRun) {
  console.log(`[dry-run] would replace line ${hits[0] + 1} of ${envPath} and back up the old file.`);
  console.log(`[dry-run] sample address (this key is discarded): ${address}`);
  process.exit(0);
}

// Same backup convention as env-set-from-file.cjs: env.bak-<stamp>, mode 600, next to the env file (gitignored).
const dir = path.dirname(envPath);
const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "");
const backup = path.join(dir, `env.bak-${stamp}`);
fs.writeFileSync(backup, original, { mode: 0o600, flag: "wx" });

const tmp = path.join(dir, `.envset-${process.pid}.tmp`);
fs.writeFileSync(tmp, lines.join(eol), { mode: 0o600 });
fs.renameSync(tmp, envPath); // atomic: the dead-man cron never reads a half-written file
fs.chmodSync(envPath, 0o600);

console.log(`${VAR}: replaced (value not shown), backup ${path.basename(backup)}`);
console.log(`AGENT ADDRESS (master-wallet owner approves this in the Hyperliquid UI): ${address}`);
console.log("Nothing is restarted: the running bot keeps its old key until `pm2 restart trading-bot`.");
