# 08 — Parallel Dispatch Patterns

Worktree isolation (see [07-worktree-isolation.md](./07-worktree-isolation.md)) makes parallel dispatch safe at the filesystem level. The orchestrator still has to decide when to dispatch in parallel and when to serialize. There are three common patterns.

## Pattern 1: Cross-domain (true parallelism)

Two supervisors in different domains touching different files. No shared state, no merge conflicts.

```
Orchestrator
  ├── Task(subagent_type="web-supervisor", prompt="BEAD_ID: proj-50, fix navigation header")
  └── Task(subagent_type="backend-supervisor", prompt="BEAD_ID: proj-51, add /api/v2/users endpoint")
```

Both dispatches happen in the same message — that is the trigger for true parallelism in Claude Code. Both supervisors run, both create their own worktrees, both push their own branches.

When to use:

- Frontend bugfix while a backend endpoint is being added.
- Test additions while feature work is happening on a different package.
- Documentation update while a refactor is in flight.

The orchestrator reviews each completion independently as it comes back.

## Pattern 2: Same-domain siblings (cautious parallelism)

Two supervisors of the same type touching different parts of the same domain. Possible but risky.

```
Orchestrator
  ├── Task(subagent_type="backend-supervisor", prompt="BEAD_ID: proj-52, refactor src/users/")
  └── Task(subagent_type="backend-supervisor", prompt="BEAD_ID: proj-53, refactor src/auth/")
```

This works only if the two subdomains are genuinely independent — no shared imports, no shared types, no shared config files. If they are, the second supervisor's branch will conflict with the first on merge.

Before dispatching, predict conflicts:

```bash
# Hypothetical: would merging bd-52 then bd-53 conflict?
git merge-tree $(git merge-base bd-52 bd-53) bd-52 bd-53
```

If `git merge-tree` reports conflicts, do not dispatch in parallel. Serialize the second one after the first lands.

A safer alternative: dispatch the first one, wait for completion, then dispatch the second with knowledge of the first's changes. This is slower but produces a clean merge history.

## Pattern 3: Dependency chain (must serialize)

One supervisor depends on the output of another. Cannot run in parallel.

```
Orchestrator
  1. Dispatch backend-supervisor for proj-52: "Add JWT signing"
  2. Wait for completion, review, merge
  3. Dispatch web-supervisor for proj-53: "Use JWT from /api/auth"
  4. Dispatch test-supervisor for proj-54: "Test full JWT flow end-to-end"
```

The web supervisor cannot start until the backend exposes JWT. The test supervisor cannot start until both web and backend agree. This is a chain.

The beads system tracks the chain explicitly with `--deps`:

```bash
bd create "Add JWT signing in backend" -d "..."           # proj-52
bd create "Use JWT in web" --deps proj-52 -d "..."        # proj-53
bd create "End-to-end JWT test" --deps proj-52,proj-53 -d "..."  # proj-54
```

`bd ready` then only shows proj-52 until it closes. After that, proj-53 becomes ready. After both close, proj-54 becomes ready.

## The single-message rule

For true parallelism in Claude Code (and most subagent runtimes), all dispatches must happen in a single assistant message. If the orchestrator dispatches one supervisor, waits for the response, then dispatches another, that is serial — even if each dispatch is fast.

To dispatch in parallel:

```
<single assistant turn>
  Task(subagent_type="web-supervisor", ...)
  Task(subagent_type="backend-supervisor", ...)
</single assistant turn>
```

Not:

```
<turn 1>
  Task(subagent_type="web-supervisor", ...)
</turn 1>
<turn 2 — after turn 1 returns>
  Task(subagent_type="backend-supervisor", ...)
</turn 2>
```

The runtime executes the tools in a single turn concurrently. Multiple turns are sequential by definition.

## Conflict prediction before dispatch

Before parallel-dispatching, the orchestrator can do a quick `Glob` to see what files each dispatch will likely touch. Heuristics that work in practice:

- If both dispatches mention the same file in their prompts, do not parallel-dispatch.
- If both dispatches are in the same package directory, be cautious.
- If both dispatches will edit a shared config (e.g. `package.json`, `tsconfig.json`), serialize.

For more rigor, use `git merge-tree` after both supervisors have produced their first commits to verify no actual conflict exists:

```bash
git fetch origin bd-52 bd-53
git merge-tree origin/master origin/bd-52 origin/bd-53
```

A non-empty output indicates a conflict that the orchestrator will have to resolve.

## When to use the same supervisor twice

Dispatching the same supervisor type twice in parallel is fine when the two tasks are genuinely independent. Examples that work:

- Web supervisor adding a footer component, while another web supervisor instance adds a header component.
- Discovery supervisor researching three different external services, each in its own bead.
- Test supervisor adding tests for module A while another instance adds tests for module B.

Examples that do not work:

- Two web supervisors both editing the global stylesheet.
- Two backend supervisors both modifying the request middleware.
- Two test supervisors both adding to the same test file.

The pattern: the question "could two humans on the team do this without coordinating?" answers it. If yes, parallel dispatch is fine. If no, serialize.

## Worked example

A common scenario: the user wants to ship a small feature that spans web, backend, and tests.

Plan:

```
1. proj-60 (epic): Add user-visible toggle for dark mode.
   ├── proj-61: Add user-preferences endpoint (backend)
   ├── proj-62: Add settings panel UI (web)
   └── proj-63: Add tests for both (depends on proj-61, proj-62)
```

Dispatch sequence:

**Turn 1 — orchestrator dispatches proj-61 and proj-62 in parallel:**

```
Task(subagent_type="backend-supervisor",
     prompt="BEAD_ID: proj-61, add GET/PUT /api/users/me/preferences...")
Task(subagent_type="web-supervisor",
     prompt="BEAD_ID: proj-62, add a settings panel with a dark-mode toggle...")
```

Both supervisors complete. Orchestrator reviews each diff, runs the relevant builds.

**Turn 2 — orchestrator dispatches proj-63:**

```
Task(subagent_type="test-supervisor",
     prompt="BEAD_ID: proj-63, add tests for the dark-mode toggle end-to-end. Reference: proj-61 added /api/users/me/preferences, proj-62 added components/SettingsPanel.tsx.")
```

Three beads, two turns, full audit trail.

## When parallel dispatch fails

If a parallel dispatch produces a merge conflict the orchestrator cannot resolve cleanly, the recovery pattern is:

1. Pick one branch as the keeper (usually the simpler change).
2. Merge it to master.
3. Open a new bead: "Rebase {other-branch} onto master post-merge."
4. Dispatch the original supervisor again with the rebase task.

Do not try to manually edit files in either worktree to fix the conflict. The orchestrator is not supposed to be doing implementation work; let the supervisor handle the rebase.

Next: [09-memory-system.md](./09-memory-system.md) covers the memory system that lets the orchestrator carry context across sessions.
