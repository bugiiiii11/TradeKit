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

# === Blockchain / Railway project-specific patterns ===
# Railway auto-deploys on push -- force-pushing main/master could corrupt prod
BLOCKED_PATTERNS+=(
  'git push.*--force.*main'
  'git push.*--force.*master'
  'git push.*-f.*main'
  'git push.*-f.*master'
)

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qE "$pattern"; then
    echo "BLOCKED by safety hook: dangerous pattern [$pattern]" >&2
    exit 2
  fi
done

exit 0
