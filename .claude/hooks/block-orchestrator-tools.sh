#!/bin/bash
#
# PreToolUse: Block orchestrator from implementation tools
# Orchestrators investigate and delegate — they don't implement.
#

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Always allow Task (delegation)
[[ "$TOOL_NAME" == "Task" ]] && exit 0

# Detect SUBAGENT context — subagents get full tool access
IS_SUBAGENT="false"
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
TOOL_USE_ID=$(echo "$INPUT" | jq -r '.tool_use_id // empty')

if [[ -n "$TRANSCRIPT_PATH" ]] && [[ -n "$TOOL_USE_ID" ]]; then
  SESSION_DIR="${TRANSCRIPT_PATH%.jsonl}"
  SUBAGENTS_DIR="$SESSION_DIR/subagents"
  if [[ -d "$SUBAGENTS_DIR" ]]; then
    MATCHING_SUBAGENT=$(grep -l "\"id\":\"$TOOL_USE_ID\"" "$SUBAGENTS_DIR"/agent-*.jsonl 2>/dev/null | head -1)
    [[ -n "$MATCHING_SUBAGENT" ]] && IS_SUBAGENT="true"
  fi
fi

[[ "$IS_SUBAGENT" == "true" ]] && exit 0

# Only gate Edit/Write tools
if [[ "$TOOL_NAME" == "Edit" ]] || [[ "$TOOL_NAME" == "Write" ]]; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

  # Allow files OUTSIDE the project repo (e.g. ~/.claude/settings.json)
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
  if [[ -n "$REPO_ROOT" ]] && [[ "$FILE_PATH" != "$REPO_ROOT"* ]]; then
    exit 0
  fi

  # Allow CLAUDE.md, plans, memory, and beads files
  [[ "$FILE_PATH" == *"/.claude/plans/"* ]] && exit 0
  [[ "$(basename "$FILE_PATH")" == "CLAUDE.md" ]] && exit 0
  [[ "$(basename "$FILE_PATH")" == "CLAUDE.local.md" ]] && exit 0
  [[ "$FILE_PATH" == *"/.claude/"*"/memory/"* ]] && exit 0
  [[ "$FILE_PATH" == *"/.beads/"* ]] && exit 0
  # Allow agent definitions and hook scripts
  [[ "$FILE_PATH" == *"/.claude/agents/"* ]] && exit 0
  [[ "$FILE_PATH" == *"/.claude/hooks/"* ]] && exit 0
  # Allow store configs and workflow files (agents need these)
  [[ "$FILE_PATH" == *"/stores/"*".json" ]] && exit 0
  [[ "$FILE_PATH" == *"/.github/"* ]] && exit 0

  # Allow edits in worktrees
  [[ "$FILE_PATH" == *"/.worktrees/"* ]] && exit 0

  # Check current branch
  CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)

  # On main/master — block edits, guide to worktree
  if [[ "$CURRENT_BRANCH" == "main" ]] || [[ "$CURRENT_BRANCH" == "master" ]]; then
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Cannot edit files on '$CURRENT_BRANCH'. Create a bead and dispatch a supervisor to work in a worktree."}}'
    exit 0
  fi

  # On feature branch — allow quick fixes with approval
  FILE_NAME=$(basename "$FILE_PATH")
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"Quick fix on branch '$CURRENT_BRANCH'? File: '$FILE_NAME'. Approve for trivial changes. Deny to use bead workflow."}}'
  exit 0
fi

# Block skip-hooks on commits
if [[ "$TOOL_NAME" == "Bash" ]]; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
  NOVERIFY="--no"+"-verify"
  if [[ "$COMMAND" == *"git commit"*"$NOVERIFY"* ]]; then
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Skipping commit hooks is blocked. Fix the issue instead."}}'
    exit 0
  fi
fi

exit 0
