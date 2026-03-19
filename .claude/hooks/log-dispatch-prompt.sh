#!/bin/bash
#
# PostToolUse:Task — Auto-log dispatch prompts to bead comments
#

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[[ "$TOOL_NAME" != "Task" ]] && exit 0

SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // empty')
[[ "$SUBAGENT_TYPE" != *"supervisor"* ]] && exit 0

PROMPT=$(echo "$INPUT" | jq -r '.tool_input.prompt // empty')
[[ -z "$PROMPT" ]] && exit 0

BEAD_ID=$(echo "$PROMPT" | grep -oE 'BEAD_ID: [A-Za-z0-9._-]+' | head -1 | sed 's/BEAD_ID: //')
[[ -z "$BEAD_ID" ]] && exit 0

TRUNCATED=$(echo "$PROMPT" | head -c 2048)
bd comment "$BEAD_ID" "DISPATCH_PROMPT [$SUBAGENT_TYPE]: $TRUNCATED" 2>/dev/null || true

exit 0
