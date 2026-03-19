#!/bin/bash
# Search knowledge base
# Usage: .beads/memory/recall.sh "keyword"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KNOWLEDGE_FILE="$SCRIPT_DIR/knowledge.jsonl"

if [[ ! -f "$KNOWLEDGE_FILE" ]]; then
  echo "No knowledge entries yet."
  exit 0
fi

if [[ -z "$1" ]]; then
  echo "Usage: $0 <keyword>"
  exit 1
fi

grep -i "$1" "$KNOWLEDGE_FILE" | jq -r '"[\(.type)] \(.content) (bead: \(.bead))"' 2>/dev/null
