# 05 — Beads Workflow

Beads (`bd`) is a git-native issue tracker. It stores tasks in a database that lives inside the repository, exposes a CLI, and survives across sessions and across agents. This framework uses one bead per unit of work.

You do not have to use Beads specifically. Any CLI-driven tracker that supports create, comment, status updates, and "ready" queries will work, with minor edits to the hooks. The pattern is what matters.

## Why a tracker at all

Without a tracker, three things go wrong:

1. **No memory between sessions.** Conversation context is lost on compaction or session end. A bead persists.
2. **No coordination between agents.** When the orchestrator dispatches two supervisors in parallel, they need a shared reference point.
3. **No audit trail.** When something breaks two weeks later, "what did the agent change and why" matters. Beads, dispatch logs, and commit messages reconstruct the story.

## Why git-native specifically

A git-native tracker (Beads stores work in a Dolt database that branches with the repo) has properties that a web tracker does not:

- **Branches with the code.** A feature branch can have its own task state.
- **Available offline.** No network call to read or update.
- **Programmable.** Hooks can call `bd` to enforce conventions.
- **Single source of truth.** No drift between the repo and an external system.

If your team uses an external tracker (Jira, Linear) for stakeholder visibility, treat Beads as the engineering-side workspace and mirror status to the stakeholder tracker at milestones.

## The lifecycle

Every task moves through four states:

```
open -> in_progress -> closed
            |
            v
         blocked (rare, when a dependency is unresolved)
```

The state changes happen through `bd` commands:

```bash
bd create "Title" -d "Description"             # creates open
bd update {ID} --status in_progress             # claim and start
bd update {ID} --status blocked                 # blocked on something
bd close {ID}                                   # mark done
```

A typical flow for one task:

```bash
# Orchestrator after planning and user approval
$ bd create "Fix W-format date parser" -d "src/parser.ts:88 returns null for 'W05-26'. Expected: Monday of week 5, year 2026."
Created: proj-42

$ bd update proj-42 --status in_progress
Updated: proj-42

# Orchestrator dispatches via Task tool with prompt:
# "BEAD_ID: proj-42\n\nFix the W-format parser..."

# Supervisor (inside the dispatch) runs:
$ bd comment proj-42 "Reproduced. Adding handler in toISODate."
$ bd comment proj-42 "LEARNED: ISO weeks use Monday as day 1, not Sunday."
# ...does the work, commits, pushes...
# ...reports BEAD proj-42 COMPLETE...

# Orchestrator reviews, then:
$ bd close proj-42
Closed: proj-42
```

## Filing a bead vs. ad-hoc work

Not every read or one-line answer needs a bead. The rule of thumb is: **anything you'd want to remember after the conversation ends gets a bead.**

| Action | Bead? |
|--------|-------|
| Searching the codebase to answer a question | No |
| Running `git log` to investigate | No |
| Fixing a typo in a comment | Optional, but cheap to file one |
| Adding a feature | Yes |
| Fixing a bug | Yes |
| Renaming a function across many files | Yes |
| Updating CLAUDE.md or memory files | No (those are the meta-layer) |
| Adding a new test | Yes if it's targeted; no if it's part of another bead |

When the orchestrator is unsure, the cost of filing an unnecessary bead is small. The cost of doing real work without one is missing context two weeks later.

## Epics

Some work spans multiple supervisors. An epic groups child beads:

```bash
$ bd create "Migrate auth from session to JWT" --type epic -d "..."
Created: proj-50 (epic)

$ bd create "Add JWT signing in backend" --parent proj-50 --deps -d "..."
Created: proj-51

$ bd create "Update web client to use JWT" --parent proj-50 --deps proj-51 -d "..."
Created: proj-52

$ bd create "Update CI to test JWT flow" --parent proj-50 --deps proj-51 -d "..."
Created: proj-53
```

The `--deps` flag is critical. With it, `bd ready` knows that proj-52 cannot start until proj-51 closes. The orchestrator can dispatch proj-53 in parallel with proj-52 because both depend only on proj-51.

When all child beads close, close the epic.

## Knowledge capture: LEARNED comments

Beads support free-form comments. The framework adopts a convention: comments starting with `LEARNED:` are insights worth preserving across tasks.

```bash
bd comment proj-42 "LEARNED: The W-format parser cannot use UTC dates because ISO week 1 is determined by local time in some implementations. Use the locale-aware Temporal API."
```

The `memory-capture.sh` hook ([06-hooks-guardrails.md](./06-hooks-guardrails.md)) watches for these comments and appends them to `.beads/memory/knowledge.jsonl`. The `session-start.sh` hook prints the latest entries when a session starts. Together, this is a lightweight long-term memory the team builds incrementally.

What belongs in a `LEARNED:` comment:

- Non-obvious behavior of a third-party library.
- A bug class that's likely to recur.
- A gotcha specific to the deployment environment.
- A pattern that worked well and should be reused.

What does not belong:

- Code snippets longer than a few lines (link to the commit instead).
- Anything project-specific that's already documented elsewhere.
- Status updates ("done", "in progress") — those are status changes, not learnings.

## Searching the knowledge base

A simple grep over the knowledge file works:

```bash
grep -i "auth" .beads/memory/knowledge.jsonl | jq -r '.content'
```

Some projects add a helper script (`.beads/memory/recall.sh`) that wraps grep with formatting. Keep it short — the file format is JSONL, one entry per line, with `key`, `type`, `content`, `source`, `ts`, `bead` fields.

## When the bead is the wrong size

Beads should be sized so a single supervisor dispatch can complete the work. If the supervisor reports "this is bigger than I thought" or comes back with partial progress, the bead was too big. Split it:

```bash
$ bd update proj-42 --status blocked
$ bd comment proj-42 "Blocked: scope too large. Splitting into proj-58 and proj-59."
$ bd create "Refactor parser internals" --parent proj-42 -d "..."
$ bd create "Add W-format support" --parent proj-42 --deps proj-58 -d "..."
```

A good bead has a single supervisor, a single domain, and an estimated review time under thirty minutes. Bigger units belong in an epic.

Next: [06-hooks-guardrails.md](./06-hooks-guardrails.md) explains how the hooks enforce the workflow described here.
