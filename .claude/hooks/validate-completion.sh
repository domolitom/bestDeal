#!/bin/bash
#
# SubagentStop: Verify supervisor work is complete
#

INPUT=$(cat)
AGENT_TRANSCRIPT=$(echo "$INPUT" | jq -r '.agent_transcript_path // empty')
[[ -z "$AGENT_TRANSCRIPT" || ! -f "$AGENT_TRANSCRIPT" ]] && echo '{"decision":"approve"}' && exit 0

LAST_RESPONSE=$(tail -200 "$AGENT_TRANSCRIPT" | jq -rs '
  [.[] | select(.message?.role == "assistant" and .message?.content != null)
   | .message.content[] | select(.text != null) | .text] | last // ""
' 2>/dev/null || echo "")

HAS_BEAD_COMPLETE=$(echo "$LAST_RESPONSE" | grep -cE "BEAD.*COMPLETE" 2>/dev/null || true)
[[ -z "$HAS_BEAD_COMPLETE" ]] && HAS_BEAD_COMPLETE=0

# Only validate supervisor completions
[[ "$HAS_BEAD_COMPLETE" -lt 1 ]] && echo '{"decision":"approve"}' && exit 0

# Extract BEAD_ID
BEAD_ID=$(echo "$LAST_RESPONSE" | grep -oE "BEAD [A-Za-z0-9._-]+" | head -1 | awk '{print $2}')
[[ -z "$BEAD_ID" ]] && echo '{"decision":"approve"}' && exit 0

# Check worktree exists
REPO_ROOT=$(cd "$(git rev-parse --git-common-dir)/.." 2>/dev/null && pwd)
WORKTREE_PATH="$REPO_ROOT/.worktrees/bd-${BEAD_ID}"

if [[ ! -d "$WORKTREE_PATH" ]]; then
  echo '{"decision":"approve"}' && exit 0
fi

# Check uncommitted changes
UNCOMMITTED=$(git -C "$WORKTREE_PATH" status --porcelain 2>/dev/null)
if [[ -n "$UNCOMMITTED" ]]; then
  cat << 'EOF'
{"decision":"block","reason":"Uncommitted changes in worktree. Run: git add -A && git commit -m \"...\""}
EOF
  exit 0
fi

echo '{"decision":"approve"}'
