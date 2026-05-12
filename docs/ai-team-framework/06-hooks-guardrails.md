# 06 — Hooks and Guardrails

Hooks are the framework's enforcement layer. Where [02-orchestrator.md](./02-orchestrator.md) and [03-supervisors.md](./03-supervisors.md) describe what agents should do, hooks describe what the runtime will let them do. Six hooks ship with the framework; each enforces one invariant.

## How hooks are wired

In Claude Code, hooks are configured in `.claude/settings.json` (or `settings.local.json`). Each hook is a shell command that runs at a specific lifecycle point — `PreToolUse`, `PostToolUse`, `SubagentStop`, `SessionStart` — and can return JSON to allow, deny, ask, or just observe.

A minimal wiring entry:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/block-orchestrator-tools.sh"
          }
        ]
      }
    ]
  }
}
```

The full wiring for all six hooks is in [`templates/settings.json`](./templates/settings.json).

Hook scripts read tool input as JSON on stdin and may emit a JSON decision on stdout:

```json
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "..."}}
```

Exit code 0 with no output means "no decision, proceed."

## The six hooks

### 1. `block-orchestrator-tools.sh`

**Event:** PreToolUse on all tools.

**Invariant:** The orchestrator cannot edit code on the main branch. Supervisors (running as subagents) can edit anywhere their tools allow.

**What it does:**
1. Always allows `Task` (the dispatch tool).
2. Detects whether the current call is from a subagent by checking the transcript path against a `subagents/` directory; if so, exits without restriction.
3. For `Edit` and `Write`, allows files outside the repo (e.g. user-level config), allows specific meta-paths inside the repo (`CLAUDE.md`, `.claude/plans/`, `.claude/agents/`, `.claude/hooks/`, memory directories, the issue tracker's directory, `.github/`, and worktree paths), denies edits on the main/master branch with a guidance message, and asks for permission on feature branches.
4. Blocks `git commit --no-verify` to prevent skipping commit hooks.

**Why it's important:** This single hook is the difference between "the orchestrator promises not to edit code" and "the orchestrator cannot edit code." Prompts drift; hooks do not.

**When to copy or modify on a new project:** Keep this one essentially as-is. Adjust the allow-list paths if your project has additional meta-files the orchestrator legitimately edits (e.g. a project-specific notes directory).

### 2. `enforce-bead-for-supervisor.sh`

**Event:** PreToolUse on `Task`.

**Invariant:** No supervisor dispatch happens without a bead ID in the prompt.

**What it does:**
1. Reads the dispatch's `subagent_type` and `prompt`.
2. If the subagent is not a supervisor (name doesn't contain `supervisor`), exits silently.
3. If the prompt does not contain `BEAD_ID:`, returns a denial with instructions to create a bead first.

**Why it's important:** Without this, the orchestrator can dispatch ad-hoc and skip the audit trail. With it, the workflow is structurally enforced.

**When to copy or modify on a new project:** Change the trigger string (`BEAD_ID:` → whatever your tracker uses, e.g. `TICKET:`, `ISSUE:`). The matching pattern in the supervisor check (`supervisor`) lets non-supervisor agents like scout and code-reviewer be dispatched without a bead — adjust if your role naming differs.

### 3. `log-dispatch-prompt.sh`

**Event:** PostToolUse on `Task`.

**Invariant:** Every supervisor dispatch is recorded in its bead.

**What it does:**
1. Extracts `BEAD_ID:` from the prompt.
2. Truncates the prompt to 2048 chars.
3. Appends a comment to the bead: `DISPATCH_PROMPT [{subagent_type}]: {prompt}`.

**Why it's important:** Two weeks later, someone (human or agent) can read the bead and see exactly what the orchestrator asked the supervisor to do. This catches a class of bugs where the dispatch prompt was malformed or missing context.

**When to copy or modify on a new project:** Replace the `bd comment` call with whatever your tracker's CLI uses. Adjust the truncation limit if your tracker has a different comment size limit.

### 4. `memory-capture.sh`

**Event:** PostToolUse on `Bash`.

**Invariant:** Every `bd comment ... "LEARNED: ..."` becomes a permanent searchable knowledge entry.

**What it does:**
1. Matches Bash commands of the form `bd comment {bead-id} "LEARNED: {content}"`.
2. Extracts the bead ID and the content after `LEARNED:`.
3. Creates a JSONL entry with `key`, `type=learned`, `content`, `source=agent`, `ts`, and `bead` fields.
4. Appends to `.beads/memory/knowledge.jsonl`.

**Why it's important:** The knowledge base grows naturally as agents work. No separate "remember this" step. The `session-start.sh` hook can then surface recent entries.

**When to copy or modify on a new project:** Adjust the command pattern if your tracker uses a different syntax. Adjust the knowledge file path if you want memory somewhere else.

### 5. `session-start.sh`

**Event:** SessionStart.

**Invariant:** Every new conversation begins with awareness of the task board.

**What it does:**
1. Checks for uncommitted changes in the main directory and prints a warning if so.
2. Lists in-progress beads (up to 5).
3. Lists ready beads (those with no blocking deps, up to 5).
4. Prints the most recent 5 knowledge entries.

**Why it's important:** A new session is a blank slate for the model. This hook gives it the bare minimum context — what's in flight, what's ready, and the most recent things the team learned — without making the user paste it in.

**When to copy or modify on a new project:** Keep the structure. Adjust limits (5 entries each) up or down based on your project's velocity. Replace `bd` calls with your tracker's equivalent.

### 6. `validate-completion.sh`

**Event:** SubagentStop.

**Invariant:** A supervisor cannot claim "BEAD COMPLETE" while its worktree has uncommitted changes.

**What it does:**
1. Reads the supervisor's transcript and pulls the last assistant message.
2. Looks for the string `BEAD.*COMPLETE`. If absent, exits with approve (this hook only validates explicit completions).
3. Extracts the bead ID and computes the worktree path.
4. If the worktree exists and has uncommitted changes (`git status --porcelain` non-empty), returns `{"decision": "block", "reason": "Uncommitted changes in worktree..."}`.

**Why it's important:** Stops the most common supervisor failure mode — declaring success while leaving dirty state behind that the orchestrator then merges without realizing.

**When to copy or modify on a new project:** The completion phrase (`BEAD {ID} COMPLETE`) and the worktree path (`.worktrees/bd-{ID}`) are matched as regex/string in the hook. Keep them consistent with your supervisor templates and your tracker's ID format.

## When to add a new hook

Add a hook whenever you find yourself adding a paragraph to `CLAUDE.md` that says "always" or "never" and isn't already enforceable. A few examples of legitimate hooks to add later:

- **Block force-push to main.** PreToolUse on Bash, matches `git push --force` to `main`/`master`, returns deny.
- **Auto-format on save.** PostToolUse on Edit/Write, runs the project's formatter on the edited file.
- **Auto-test on commit.** PostToolUse on Bash matching `git commit`, runs the test suite, blocks the commit on failure. (Careful — this can be slow.)
- **Enforce branch naming.** PreToolUse on Bash matching `git checkout -b`, requires the branch name to start with `bd-`.

Hooks should be short (under 100 lines), deterministic, and fast (under a second for PreToolUse — longer for PostToolUse is fine since it doesn't block the user). When a hook gets complex, move logic into a helper script and keep the hook itself thin.

## Hook edge cases

A few things to know:

**Hooks run for every matching tool call.** Test your `PreToolUse` hook on a busy workload to make sure it's not adding noticeable latency.

**The `subagent_type` check distinguishes orchestrator from supervisor.** The framework relies on the runtime exposing subagent context (transcript path + subagent directory) for the orchestrator block to work correctly. If your runtime exposes this differently, adapt the detection in `block-orchestrator-tools.sh`.

**Hooks see the input as JSON.** Use `jq` to parse it; do not try to grep the raw JSON. The hooks in this framework all rely on `jq` being available in `$PATH`.

**Exit code matters.** Exit 0 with no stdout means "no decision." Stdout JSON with `permissionDecision` overrides. Exit non-zero is also a soft failure but doesn't communicate intent; prefer JSON.

**`SubagentStop` runs after the subagent says it's done.** It can block the completion, but it cannot make the subagent do more work — only force the user/orchestrator to handle it.

Next: [07-worktree-isolation.md](./07-worktree-isolation.md) explains the worktree setup that hook 6 depends on.
