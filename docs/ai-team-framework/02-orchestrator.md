# 02 — The Orchestrator

The orchestrator is the only agent the user talks to. It does not write code. It investigates, plans, dispatches supervisors, reviews their output, and commits.

The orchestrator has a name and a position. Examples: "Melody, Senior Full-Stack Engineer" on one project; "Atlas, Tech Lead" on another. The name is for continuity (see [01-philosophy.md](./01-philosophy.md)).

## The loop

The orchestrator follows a five-step loop for every non-trivial task:

```
investigate -> plan -> discuss -> delegate -> review -> commit
```

Each step has a specific purpose and a specific set of tools.

### 1. Investigate

The orchestrator uses read-only tools (`Glob`, `Grep`, `Read`, and read-only `Bash` like `git log`) to understand what is being asked. It can dispatch the [scout](./04-roles-catalog.md) supervisor for codebase mapping when the search space is large.

The investigation produces a one-paragraph summary of what is going on and what the user wants. If the user's request is vague, this is where the orchestrator asks clarifying questions.

### 2. Plan

The orchestrator drafts an approach in plain prose: which supervisors will be involved, what files they'll touch, what order things have to happen in, and what could go wrong.

Plans live in `.claude/plans/` as markdown when they are long-lived. Short plans live in the conversation. Either way, the plan is explicit, not implicit.

### 3. Discuss

The orchestrator presents the plan and waits. It does not start dispatching until the user says yes. This is the rule that prevents most surprises.

A typical orchestrator turn at this stage:

```
Plan:

1. Dispatch backend-supervisor to fix the date parser in src/parser.ts
2. Dispatch test-supervisor to add regression tests
3. Run the full suite, commit, push

Ready to proceed?
```

If the user pushes back, the plan changes. If the user says yes, dispatch begins.

### 4. Delegate

For each unit of work the orchestrator:

1. Creates a bead: `bd create "Title" -d "Description with file references"`.
2. Marks it in progress: `bd update {ID} --status in_progress`.
3. Dispatches a supervisor via the `Task` tool, passing `BEAD_ID: {ID}` in the prompt.

See [05-beads-workflow.md](./05-beads-workflow.md) for the full bead lifecycle and [08-parallel-patterns.md](./08-parallel-patterns.md) for when to dispatch supervisors in parallel.

A dispatch prompt looks like:

```
BEAD_ID: proj-42

The date parser in src/parser.ts rejects ISO weeks of the form "W{n}-{yy}".
Add support so toISODate("W05-26") returns the Monday of week 5 of year 2026.
Reference: src/parser.ts:88, tests already exist for similar formats in tests/parser.test.ts.
```

Always pass enough context that the supervisor doesn't have to ask. Always include the bead ID; a hook will refuse the dispatch otherwise (see [06-hooks-guardrails.md](./06-hooks-guardrails.md)).

### 5. Review and commit

When a supervisor reports `BEAD {ID} COMPLETE`, the orchestrator does not just close the bead. It:

1. Checks out the supervisor's branch (or visits the worktree).
2. Runs `git diff` against `main`.
3. Reads through the changes — every file, every hunk.
4. Runs the relevant build or test command.
5. If something is off, opens a follow-up bead or dispatches the supervisor again with a correction.
6. If everything looks right, merges (or pushes after asking the user).
7. Closes the bead.

Reviewing supervisor output is non-negotiable. A supervisor can claim success and still have committed broken code. The orchestrator is the last line of defense.

## Tool restrictions

The orchestrator does not have direct write access to the codebase. This is enforced by a pre-tool hook (`block-orchestrator-tools.sh`, see [06-hooks-guardrails.md](./06-hooks-guardrails.md)) which:

- Allows `Edit` and `Write` on `CLAUDE.md`, plans, memory files, agent definitions, hooks, and the issue tracker's directory.
- Allows `Edit` and `Write` inside any path under `.worktrees/`.
- Blocks `Edit` and `Write` on the main branch, returning a denial that tells the agent to use the bead workflow.
- Asks for permission on feature branches (lets the user say yes to trivial fixes).

The orchestrator can always use `Task` (to dispatch), `Glob`, `Grep`, `Read`, `Bash` for read-only commands, and `WebFetch`/`WebSearch` where the runtime allows.

Why this matters: when the orchestrator is convinced that "this is a one-line change, I'll just fix it on master," the hook says no. The agent learns to dispatch even small changes through a supervisor, and the audit trail stays intact.

## Discuss before acting

The orchestrator must summarize its plan and wait for the user before any action that changes state. State-changing actions include:

- Creating a bead.
- Dispatching a supervisor.
- Pushing to a remote.
- Closing a bead.

Pure investigation — reading files, running `git log`, searching the codebase — does not require confirmation. This rule keeps the user in control of the work plan without making every read a checkpoint.

The corollary: the orchestrator never says "I'll go ahead and..." and then proceeds. It says "Here is the plan. Approve?" and stops.

## Reviewing parallel dispatches

When the orchestrator dispatches several supervisors in parallel (see [08-parallel-patterns.md](./08-parallel-patterns.md)), each one comes back independently. The review step has to handle two failure modes:

1. **Partial completion.** One supervisor succeeds, another fails. The orchestrator reviews the successful work, closes that bead, and decides whether to retry the failed one or escalate.
2. **Merge conflicts.** Two supervisors edited the same file in incompatible ways. The orchestrator either merges manually (rare) or dispatches a follow-up bead to reconcile.

A good practice: before dispatching parallel supervisors, predict the file overlap with `git merge-tree` or a quick `Glob`. If two dispatches would write to the same file, serialize them.

## Pushing to remote

The orchestrator never pushes to the remote without asking. Even if the user said "go ahead and finish this" earlier in the conversation, push is a separate confirmation. This is the simplest way to avoid pushing partial work, work the user wanted to review locally first, or work to the wrong branch.

The phrase to use: "Ready to push to origin/{branch}?" Wait for a clear yes.

Next: [03-supervisors.md](./03-supervisors.md) describes how supervisors are written.
