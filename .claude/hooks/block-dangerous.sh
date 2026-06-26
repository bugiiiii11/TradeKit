#!/bin/bash
# PreToolUse: Block dangerous Bash command patterns
# Exit 2 = block, Exit 0 = allow

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# === Universal dangerous patterns ===
BLOCKED_PATTERNS=(
  'rm -rf /'
  'rm -rf ~'
  'rm -rf \.'
  'curl.*\|.*bash'
  'curl.*\|.*sh'
  'wget.*\|.*bash'
  'wget.*\|.*sh'
  ':\(\)\{.*\|.*&.*\};'
  'dd if=/dev'
  'mkfs\.'
  '> /dev/sd'
  'chmod -R 777 /'
  'eval.*\$\(curl'
)

# === Repo-integrity guard ===
# TradeKit commits directly to main (no review gate); force-pushing main/master
# would rewrite shared history. Block it.
BLOCKED_PATTERNS+=(
  'git push.*--force.*main'
  'git push.*--force.*master'
  'git push.*-f.*main'
  'git push.*-f.*master'
)

# === TradeKit secret-exfil guards ===
# .env and the wallet/service-role keys must never be read, printed, or
# committed via Bash. protect-files.sh only covers Edit/Write, not reads/exfil.
# .env.example / .sample / .template are intentionally NOT blocked. source/.
# loads (used by the bot at runtime) are intentionally NOT blocked.
BLOCKED_PATTERNS+=(
  # Reading the live .env (and per-environment variants; templates excluded)
  '(cat|less|more|head|tail|nl|xxd|od|strings)[[:space:]].*\.env($|[[:space:]]|"|'"'"'|\.local|\.production|\.development|\.staging|\.test)'
  # Printing secret env vars by name
  '(echo|printf|printenv).*(PRIVATE_KEY|SERVICE_ROLE_KEY|S5_WEBHOOK_SECRET)'
  # Dumping the whole environment (bare, or piped into grep to sift keys)
  '(^|[[:space:]])printenv[[:space:]]*$'
  '(^|[[:space:]])(printenv|env)[[:space:]]*\|[[:space:]]*grep'
  # Staging the .env for commit
  'git[[:space:]]+add[[:space:]].*\.env($|[[:space:]]|"|'"'"'|\.local|\.production|\.development|\.staging|\.test)'
)

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qE "$pattern"; then
    echo "BLOCKED by safety hook: dangerous pattern [$pattern]" >&2
    exit 2
  fi
done

exit 0
