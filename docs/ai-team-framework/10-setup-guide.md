# 10 — Setup Guide

This is the recipe for applying the framework to a new project. Allow about an hour for the full setup; the first task is dispatched at step 6.

The guide uses Claude Code conventions throughout. For other runtimes, the file paths and hook wiring may differ — see the [README compatibility note](./README.md#compatibility).

## Prerequisites

- A git repository, ideally with at least one initial commit.
- Bash, `jq`, and `git` available in the project's terminal.
- The Beads CLI: `curl -sSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash`
- A Claude Code installation (or an equivalent harness with subagents and hooks).

## Step 1: Drop in `CLAUDE.md`

Copy [`templates/CLAUDE.md`](./templates/CLAUDE.md) to the repo root as `CLAUDE.md`. Edit:

- `{{PROJECT_NAME}}` — the project's display name.
- `{{ORCHESTRATOR_NAME}}` — pick a name (Melody, Atlas, Pilot, etc.).
- `{{TEAM_TABLE}}` — list the supervisors you plan to use. Start small; you can add more later.
- `{{BUILD_COMMANDS}}` — the actual `bun run`, `npm run`, `cargo`, etc. for this project.
- `{{ARCHITECTURE_PARA}}` — one paragraph on the codebase shape.
- `{{CURRENT_STATE}}` — bullets on what's live, what's in progress, what's blocked.

Aim for under 150 lines. If `CLAUDE.md` gets long, push detail into the user-level memory directory.

## Step 2: Add agent definitions

Create `.claude/agents/` and copy the templates you need from [`templates/agents/`](./templates/agents/). Suggested minimum:

- `web-supervisor.md` if there's a frontend.
- `backend-supervisor.md` if there's a server, CLI, or pipeline.
- `test-supervisor.md` always.
- `code-reviewer.md` once you have multiple supervisors producing diffs.

For each template, edit the placeholders:

- `{{SUPERVISOR_NAME}}` — the persona's name.
- `{{ROLE}}` — one-line role description.
- `{{DOMAIN_PATH}}` — the directory the supervisor owns.
- `{{TECH_STACK}}` — actual tech in use.
- `{{KEY_FILES}}` — paths to entry points and important files.
- `{{CONSTRAINTS}}` — the "no edits outside X" rules.
- `{{QUALITY_GATES}}` — what `bun test`, `npm test`, etc. must pass.

Each agent file should fit on one screen after editing. If it doesn't, the role is probably too broad — split it.

## Step 3: Wire the hooks

Copy [`templates/hooks/`](./templates/hooks/) to `.claude/hooks/`. Mark every script executable:

```bash
chmod +x .claude/hooks/*.sh
```

Open the templates and replace placeholders:

- `BEAD_ID:` in the prompt-detection regex (only change if your tracker uses a different marker).
- The supervisor name pattern in `enforce-bead-for-supervisor.sh` if your agents don't all end in `-supervisor`.
- The completion phrase in `validate-completion.sh` if you prefer something other than `BEAD {ID} COMPLETE`.

Then copy [`templates/settings.json`](./templates/settings.json) to `.claude/settings.json` (or merge into your existing settings). The hooks will not run until they are referenced here.

Verify the wiring:

```bash
cat .claude/settings.json | jq .hooks
```

You should see entries under `PreToolUse`, `PostToolUse`, `SubagentStop`, and `SessionStart`.

## Step 4: Initialize Beads

In the repo root:

```bash
bd init
```

This creates `.beads/` with a database, a `README.md`, and a `config.yaml`. The default issue prefix is the repo directory name; change it in `config.yaml` if you want something shorter:

```yaml
issue-prefix: "proj"
```

Add the runtime files (but not the database state) to `.gitignore`:

```
.beads/dolt-server.*
.beads/.local_version
.beads/last-touched
.beads/dolt-server.pid
.beads/dolt-server.port
```

The `.beads/issues.jsonl` (in JSONL mode) or `.beads/dolt/` (in Dolt mode) directory is the source of truth and should be committed.

## Step 5: Seed initial memory

Create `~/.claude/projects/{project-id}/memory/MEMORY.md` (or your runtime's equivalent user memory path). Use [`templates/CLAUDE.md`](./templates/CLAUDE.md) as a skeleton, but at the user level. Include:

- A one-paragraph overview of the project.
- A list of feedback rules you already have ("never push without asking," etc.).
- Pointers to any external systems (CI dashboards, deployment URLs).

Add the `.worktrees/` directory to `.gitignore`:

```
.worktrees/
```

## Step 6: First-run sanity check

Open a new conversation with the orchestrator. The `session-start.sh` hook should print the task board (empty at this point) and any knowledge entries (also empty).

Create a tiny bead to exercise the workflow:

```bash
bd create "Smoke test: add a comment to README" -d "Add a short comment to README.md just to verify the workflow works end to end."
# returns: proj-1 (or whatever your prefix is)
```

Ask the orchestrator to dispatch the appropriate supervisor:

```
"Please dispatch a supervisor for proj-1."
```

Watch for:

1. The orchestrator creates a worktree at `.worktrees/bd-proj-1/`.
2. The supervisor edits inside the worktree, commits, and pushes.
3. The supervisor reports `BEAD proj-1 COMPLETE`.
4. The `validate-completion.sh` hook approves (no uncommitted changes left).
5. The `log-dispatch-prompt.sh` hook adds a `DISPATCH_PROMPT` comment to the bead.

If any of those fail, the hook will tell you what to fix. The most common first-time issues:

- `bd` not on PATH — install it and confirm `which bd`.
- `jq` not on PATH — install it.
- Hook scripts not executable — `chmod +x .claude/hooks/*.sh`.
- Orchestrator trying to edit on master directly — the block hook fires. This is correct; create a bead and dispatch instead.

## Step 7: Customize for your project

The framework is a starting point. As you work, expect to:

- **Add more agents.** The first new agent is usually `infra-supervisor` once you have a CI pipeline, or `discovery-supervisor` if you accumulate external sources.
- **Tune hook allow-lists.** If `block-orchestrator-tools.sh` keeps denying edits to a meta-file the orchestrator legitimately owns, add it to the allow list.
- **Adjust completion phrases.** If `BEAD {ID} COMPLETE` doesn't fit your house style, change it consistently across `validate-completion.sh` and the agent templates.
- **Add domain-specific hooks.** Lint enforcement, format-on-save, branch naming rules — anything that's currently a paragraph in `CLAUDE.md` could be a hook instead.
- **Trim agents you don't use.** A six-agent team where two agents have never been dispatched is just clutter. Remove them; you can always add them back.

## Step 8: Establish a rhythm

A working rhythm for a solo developer + orchestrator + team:

- **Start of session.** Read what the session-start hook printed. Pick one in-progress bead or one ready bead.
- **Plan in the orchestrator's voice.** Even for a small task, summarize what you'll do before doing it.
- **Dispatch.** One bead at a time, or two in parallel if they don't conflict.
- **Review every diff.** Don't merge without reading. The orchestrator will not catch every regression.
- **Close beads explicitly.** A closed bead is the unit of "done." A merged branch with no closed bead is half-done.
- **Capture learnings.** Whenever you discover something non-obvious, `bd comment {ID} "LEARNED: ..."`.
- **End of session.** Make sure no in-progress bead is actually abandoned. Either complete it, block it with a reason, or close it as won't-fix.

After a couple of weeks, the team picks up patterns from the knowledge base and starts producing work that needs less correction. That is the framework paying off.

## Customization points by project size

A condensed view of what to keep and what to skip:

| Project size | Keep | Add later | Skip |
|--------------|------|-----------|------|
| Solo, <5kloc | Orchestrator, one implementation supervisor, test supervisor, all 6 hooks, Beads | Code reviewer, infra | Scout, UX tester, discovery |
| Solo, 5-50kloc | Add web + backend split, scout | Discovery, UX tester | — |
| Small team, any size | Full nine-role team | — | — |
| Large team | Full team, plus shadow supervisors for specialty domains | — | — |

The hooks scale well — they cost essentially nothing per call. Always wire all six unless you have a specific reason to drop one.

That's the setup. Refer back to the numbered docs as questions come up. The framework is designed to be used, not memorized.
