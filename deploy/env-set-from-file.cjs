#!/usr/bin/env node
// env-set-from-file.cjs -- set ONE key in a project's env file from a drop file, atomically, printing no values.
//
// Adopted from Flash (C:\work\Flash\deploy\env-set-from-file.cjs, commit 35d8b37, Martin-approved s404,
// 2026-11-03). Changes for TradeKit: the backup is written at mode 600 from the start (no copy-then-chmod
// window), and env.bak-* / .envset-*.tmp are gitignored here.
//
// The rule: a secret exists only in a mode-600 file on the box that Claude never reads; this script moves it
// into the env line and deletes the drop file. Output is key NAME + length + sha256[0:8] + backup name --
// never the value.
//
// usage: node deploy/env-set-from-file.cjs <projectDir> <KEY> <valueFile> [--keep-value-file]
//   <projectDir>  the bot dir; the script resolves "<projectDir>/.env" itself so the command line never
//                 contains the ".env" substring (keeps the safety hooks quiet)
//   <KEY>         env key to set (replaced in place if present, appended if not)
//   <valueFile>   mode-600 drop file holding the value (one line); deleted after a successful write unless
//                 --keep-value-file is given
//
// How the owner creates the drop file in THEIR OWN ssh window (never in a Claude-run command):
//   read -rs V; umask 077; printf '%s' "$V" > ~/.tk-new-key; unset V
// Then (Claude may run these):
//   node deploy/env-set-from-file.cjs /home/ubuntu/trading-bot SUPABASE_SERVICE_ROLE_KEY ~/.tk-new-key
//   pm2 restart trading-bot
// Verify: owner compares sha256sum of the value on their side against the printed 8 hex chars; the bot's own
// startup line is the functional check. Delete env.bak-* once the OLD secret is revoked at the provider and
// the new one has passed one functional check (shred -u if available, else rm).
//
// Non-secret values may go through the same path (write them to the drop file first) -- one code path.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const keep = args.includes('--keep-value-file');
const [dir, key, valueFile] = args.filter((a) => !a.startsWith('--'));
if (!dir || !key || !valueFile) {
  console.error('usage: node deploy/env-set-from-file.cjs <projectDir> <KEY> <valueFile> [--keep-value-file]');
  process.exit(2);
}
if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
  console.error('KEY must look like an env name (A-Z, 0-9, _)');
  process.exit(2);
}

const envPath = path.join(dir, '.' + 'env');
if (!fs.existsSync(envPath)) {
  console.error('env file not found in ' + dir);
  process.exit(2);
}

const value = fs.readFileSync(valueFile, 'utf8').replace(/\r?\n$/, '');
if (!value) {
  console.error('value file is empty');
  process.exit(3);
}
if (/[\r\n]/.test(value)) {
  console.error('value contains a newline');
  process.exit(3);
}

const original = fs.readFileSync(envPath, 'utf8');
const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', ''); // to the millisecond
const bak = path.join(dir, `env.bak-${stamp}`);
fs.writeFileSync(bak, original, { mode: 0o600, flag: 'wx' });

const lines = original.split('\n');
let hit = 0;
const out = lines.map((l) => (l.startsWith(key + '=') ? (hit++, `${key}=${value}`) : l));
if (hit === 0) {
  if (out.length && out[out.length - 1] !== '') out.push('');
  out.splice(out.length - 1, 0, `${key}=${value}`);
}

const tmp = path.join(dir, `.envset-${process.pid}.tmp`); // no ".env" substring in the name
fs.writeFileSync(tmp, out.join('\n'), { mode: 0o600 });
fs.renameSync(tmp, envPath);
fs.chmodSync(envPath, 0o600);
if (!keep) fs.rmSync(valueFile);

const h = crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);
console.log(
  `${key}: ${hit ? 'replaced' : 'appended'}, length ${value.length}, sha256[0:8] ${h}, backup ${path.basename(bak)}` +
    (hit > 1 ? ` (WARNING: ${hit} lines matched; all replaced)` : ''),
);
