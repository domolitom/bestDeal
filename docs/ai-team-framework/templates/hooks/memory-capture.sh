#!/bin/bash
#
# PostToolUse:Bash — Capture LEARNED comments into the knowledge base.
#
# HOWTO: Copy to .claude/hooks/memory-capture.sh, chmod +x.
# Adjust the bd command pattern if you use a different tracker.
# Adjust MEMORY_DIR if you want knowledge stored elsewhere.
#

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[[ "$TOOL_NAME" != "Bash" ]] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
echo "$COMMAND" | grep -qE 'bd\s+comment\s+' || exit 0
echo "$COMMAND" | grep -qE 'LEARNED:' || exit 0

BEAD_ID=$(echo "$COMMAND" | sed -E 's/.*bd[[:space:]]+comment[[:space:]]+([A-Za-z0-9._-]+)[[:space:]]+.*/\1/')
[[ -z "$BEAD_ID" || "$BEAD_ID" == "$COMMAND" ]] && exit 0

COMMENT_BODY=$(echo "$COMMAND" | sed -E "s/.*bd[[:space:]]+comment[[:space:]]+[A-Za-z0-9._-]+[[:space:]]+[\"']//" | sed -E "s/[\"'][[:space:]]*$//" | head -c 4096)
[[ -z "$COMMENT_BODY" ]] && exit 0

CONTENT=$(echo "$COMMENT_BODY" | sed 's/.*LEARNED:[[:space:]]*//' | head -c 2048)
[[ -z "$CONTENT" ]] && exit 0

SLUG=$(echo "$CONTENT" | head -c 60 | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')
KEY="learned-${SLUG}"
TS=$(date +%s)

ENTRY=$(jq -cn \
  --arg key "$KEY" \
  --arg type "learned" \
  --arg content "$CONTENT" \
  --arg source "agent" \
  --argjson ts "$TS" \
  --arg bead "$BEAD_ID" \
  '{key: $key, type: $type, content: $content, source: $source, ts: $ts, bead: $bead}')

MEMORY_DIR="${CLAUDE_PROJECT_DIR:-.}/.beads/memory"
mkdir -p "$MEMORY_DIR"
echo "$ENTRY" >> "$MEMORY_DIR/knowledge.jsonl"

exit 0
