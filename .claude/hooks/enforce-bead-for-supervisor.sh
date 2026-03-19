#!/bin/bash
#
# PreToolUse:Task — Enforce bead exists before supervisor dispatch
#

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[[ "$TOOL_NAME" != "Task" ]] && exit 0

SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // empty')
PROMPT=$(echo "$INPUT" | jq -r '.tool_input.prompt // empty')

# Only enforce for supervisors
[[ ! "$SUBAGENT_TYPE" =~ supervisor ]] && exit 0

# Check for BEAD_ID in prompt
if [[ "$PROMPT" != *"BEAD_ID:"* ]]; then
  cat << 'EOF'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"All supervisor work MUST be tracked with a bead.\n\n1. bd create \"Task title\" -d \"Description\"\n2. Dispatch with: BEAD_ID: {id}\n\nEach task creates its own worktree at .worktrees/bd-{BEAD_ID}/"}}
EOF
  exit 0
fi

exit 0
