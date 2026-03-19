#!/bin/bash
#
# SessionStart: Show task context from beads
#

BEADS_DIR="$CLAUDE_PROJECT_DIR/.beads"
[[ ! -d "$BEADS_DIR" ]] && exit 0

if ! command -v bd &>/dev/null; then
  echo "beads CLI (bd) not found. Install: npm install -g @beads/bd"
  exit 0
fi

# Warn about uncommitted changes
REPO_ROOT=$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --show-toplevel 2>/dev/null)
if [[ -n "$REPO_ROOT" ]]; then
  DIRTY=$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)
  if [[ -n "$DIRTY" ]]; then
    echo "WARNING: Main directory has uncommitted changes."
    echo ""
  fi
fi

echo "## Task Board"
echo ""

IN_PROGRESS=$(bd list --status in_progress 2>/dev/null | head -5)
if [[ -n "$IN_PROGRESS" ]]; then
  echo "### In Progress:"
  echo "$IN_PROGRESS"
  echo ""
fi

READY=$(bd ready 2>/dev/null | head -5)
if [[ -n "$READY" ]]; then
  echo "### Ready:"
  echo "$READY"
  echo ""
fi

if [[ -z "$IN_PROGRESS" && -z "$READY" ]]; then
  echo "No active beads. Create one with: bd create \"Task\" -d \"Description\""
fi

# Knowledge base
KNOWLEDGE_FILE="$BEADS_DIR/memory/knowledge.jsonl"
if [[ -f "$KNOWLEDGE_FILE" && -s "$KNOWLEDGE_FILE" ]]; then
  TOTAL=$(wc -l < "$KNOWLEDGE_FILE" | tr -d ' ')
  echo ""
  echo "## Knowledge ($TOTAL entries)"
  tail -5 "$KNOWLEDGE_FILE" | jq -r '"  [\(.type)] \(.content | .[0:80])"' 2>/dev/null
fi
