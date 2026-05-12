# 03 — Supervisors

A supervisor is a domain-scoped subagent. The orchestrator dispatches it via `Task(subagent_type="...", prompt="BEAD_ID: ...")`. Supervisors do the actual work: edits, builds, tests, commits.

## Anatomy of a supervisor definition

Each supervisor is a single markdown file under `.claude/agents/`. The file has YAML frontmatter and a markdown body.

```markdown
---
name: backend-supervisor
description: Server pipeline, business logic, and data integration
model: sonnet
tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - LSP
---

# Backend Supervisor: "Nico"

You are **Nico**, the Backend Supervisor for the {ProjectName} project.

- **Name:** Nico
- **Position:** Backend / Automation
- **Role:** Backend Supervisor
- **Personality:** Methodical, persistent, handles flaky services with patience

## Your Domain

`src/backend/` — the server-side pipeline.

## Tech Stack

- Runtime: ...
- Framework: ...
- Storage: ...

## Key Files

- `src/backend/index.ts` — entry point
- `src/backend/handlers/` — request handlers
- `src/backend/lib/` — shared utilities

## Constraints

- No edits outside `src/backend/`.
- Tests must pass: `bun test`.
- ...

## Workflow

1. Read `BEAD_ID` from prompt.
2. `bd update {BEAD_ID} --status in_progress`
3. Create worktree: `git worktree add .worktrees/bd-{BEAD_ID} -b bd-{BEAD_ID}`
4. Work in the worktree.
5. Test before committing.
6. Commit, push, update bead.
7. Report: `BEAD {BEAD_ID} COMPLETE`

## Quality Gates

- All tests pass.
- No type errors.
- ...
```

Six fields make a supervisor:

| Field | Purpose |
|-------|---------|
| `name` | Unique ID used by `Task(subagent_type=...)`. |
| `description` | One-line summary the orchestrator sees when picking a supervisor. |
| `model` | Which model size to use. Cheaper roles (scout, reviewer) can use a smaller model. |
| `tools` | Explicit allowlist. Never grant tools the role doesn't need. |
| Personality block | Name, position, role, one-line personality. Drives tone and rigor. |
| Workflow block | Numbered steps the supervisor follows on every dispatch. |

## Why personalities and names matter

Three reasons, repeating from [01-philosophy.md](./01-philosophy.md) with concrete examples.

**Continuity.** When the orchestrator's notes say "Granny found three accessibility issues on the catalog page last run," the user knows immediately which agent and what kind of feedback. Compare to "the UX testing subagent run from 2026-03-25 produced..." — same information, worse memory.

**Tone amplification.** A code reviewer described as "finds every flaw, leaves no line unexamined" produces more nitpicky reviews than a code reviewer with no character. The persona is a low-cost prompt hint that the model uses to set its register.

**Memorability.** Users say "ask Bricky to run the tests" instead of "dispatch the test supervisor." This is a small thing that adds up over hundreds of interactions.

Constraints: keep personalities short (one to two lines), keep names distinct so there's no confusion, and never let personality override the workflow. The numbered steps are mandatory; the personality is decoration.

## Tool selection per role

The supervisor's `tools` list is an allowlist. The default should be the minimum set that lets the role do its job. Examples:

| Role | Typical tools | Why |
|------|---------------|-----|
| Backend supervisor | Read, Write, Edit, Glob, Grep, Bash, LSP | Full implementation set. |
| Web supervisor | Read, Write, Edit, Glob, Grep, Bash, LSP | Same — implementation role. |
| Discovery supervisor | Read, Write, Edit, Glob, Grep, Bash, WebFetch, WebSearch | Needs internet to research. |
| Test supervisor | Read, Write, Edit, Glob, Grep, Bash, LSP | Writes tests, runs builds. |
| Infra supervisor | Read, Write, Edit, Glob, Grep, Bash | YAML, Dockerfiles, no LSP needed. |
| UX tester | Read, Glob, Grep, Bash, WebFetch, WebSearch | Tests the live site, files beads, does not write code. |
| Scout | Read, Glob, Grep, LSP | Read-only. Does not write anything. |
| Code reviewer | Read, Glob, Grep, Bash | Read code, run tests, report. |

A common mistake is giving every supervisor `Write` and `Edit`. The UX tester does not need to write code; granting it Write tools means it might do so. Scope first, expand later if needed.

## Mode of operation: worktree-first

Every implementation supervisor follows the same pattern:

1. Create a worktree at `.worktrees/bd-{BEAD_ID}/` on a new branch `bd-{BEAD_ID}`.
2. Make all changes inside the worktree.
3. Commit on the branch.
4. Push the branch.
5. Report completion. The orchestrator merges (or asks the user to merge).

This is what keeps parallel dispatches from clobbering each other. See [07-worktree-isolation.md](./07-worktree-isolation.md) for the full rationale.

Read-only supervisors (scout, code reviewer, UX tester) do not need worktrees — they don't change files. They run from the main checkout.

## Per-supervisor scoping rules

Supervisors must be sharply scoped. Two rules to follow:

**One domain per supervisor.** A web supervisor handles the web package, end to end. Do not split it into `react-supervisor` and `css-supervisor`; those are sub-tasks within one role, not separate roles. The right axis to split on is "different stack" or "different lifecycle stage" (research vs implementation vs review), not "different file extension."

**Explicit constraints.** Each supervisor's markdown should list what it does not do. Example: "No edits outside `packages/web/`. Routes must use `export const runtime = 'edge'`." These constraints are visible to the model on every dispatch and act as guardrails.

When in doubt, look at the directory tree. If two supervisors would touch the same directories most of the time, they are the same supervisor.

## Workflow steps the supervisor must follow

Every implementation supervisor's markdown ends with a numbered workflow. The same shape repeats:

```
1. Read BEAD_ID from prompt.
2. bd update {BEAD_ID} --status in_progress
3. git worktree add .worktrees/bd-{BEAD_ID} -b bd-{BEAD_ID}
4. Work in the worktree.
5. Run quality gates (tests, build, typecheck).
6. Commit and push the branch.
7. Report: BEAD {BEAD_ID} COMPLETE
```

The validate-completion hook ([06-hooks-guardrails.md](./06-hooks-guardrails.md)) checks step 6 — if the worktree has uncommitted changes when the supervisor says "complete," the hook blocks the completion. The supervisor must finish its commits before reporting done.

## Reporting completion

The exact string `BEAD {ID} COMPLETE` is load-bearing. The `validate-completion.sh` hook scans for it. Stick to the format.

A typical completion message:

```
BEAD proj-42 COMPLETE

Changes:
- src/parser.ts: added W-format handling at line 88
- tests/parser.test.ts: added two regression cases

Tests: 137/137 pass
Build: ok

Branch: bd-proj-42
```

If the supervisor cannot complete, it should not say "COMPLETE." It should report what it tried, what failed, and what the orchestrator should do next.

Next: [04-roles-catalog.md](./04-roles-catalog.md) lists the standard nine roles.
