# AI Team Framework

A reusable pattern for coordinating multiple AI coding agents on a single project. One orchestrator investigates and plans, several supervisors implement in their own domains, and a small set of hooks plus a git-native issue tracker keep everything honest across sessions.

This framework is for projects where work spans several distinct surfaces (frontend, backend, infrastructure, research, QA) and a flat pool of generalist agents starts losing track of who did what, why, and where. It assumes you have a single human user driving the agent at the top of the loop, and a runtime (Claude Code, the Agent SDK, or any harness that supports subagents and hooks) that can dispatch role-scoped subagents and run pre/post-tool shell hooks.

## When to use it

Use this framework when at least three of the following are true:

- The codebase has more than one clearly different stack (e.g. a TypeScript web app and a Python data pipeline).
- You expect to dispatch parallel work that touches different files.
- Multiple sessions over days or weeks need to share context that doesn't fit in a single prompt.
- You want deterministic guardrails (no edits on `main`, no untracked work, no skipped hooks) rather than relying on prompt instructions alone.
- You want a paper trail per task that survives session compaction.

Single-file scripts, short throwaway projects, and exploratory notebooks do not need this. Use one agent and move on.

## Table of contents

| # | Document | Topic |
|---|----------|-------|
| | [01-philosophy.md](./01-philosophy.md) | Why orchestrator + supervisors, why named characters, why hooks |
| | [02-orchestrator.md](./02-orchestrator.md) | The orchestrator role: investigate, plan, delegate, review |
| | [03-supervisors.md](./03-supervisors.md) | Anatomy of a supervisor and how to write one |
| | [04-roles-catalog.md](./04-roles-catalog.md) | The nine standard roles and when each pulls its weight |
| | [05-beads-workflow.md](./05-beads-workflow.md) | Tracking work with `bd` from create to close |
| | [06-hooks-guardrails.md](./06-hooks-guardrails.md) | The six hooks, what each enforces, when to add new ones |
| | [07-worktree-isolation.md](./07-worktree-isolation.md) | Why supervisors work in isolated git worktrees |
| | [08-parallel-patterns.md](./08-parallel-patterns.md) | Same-domain, cross-domain, and dependency-chain dispatch |
| | [09-memory-system.md](./09-memory-system.md) | User, feedback, project, and reference memory |
| | [10-setup-guide.md](./10-setup-guide.md) | Step-by-step recipe for a new project |

Ready-to-edit templates live in [templates/](./templates/) — copy them into a new repository and fill in the placeholders.

## Quick start

If you already understand the pattern and just want to apply it, jump to [10-setup-guide.md](./10-setup-guide.md). It walks through copying the templates, wiring the hooks, installing `bd`, and dispatching your first tracked task.

## Compatibility

The pattern works with any harness that provides:

- Named subagents with restricted tool access (the supervisors).
- Pre-tool and post-tool hooks that can read tool calls and return a permission decision.
- A persistent project root and a way to set a project-level configuration file.

It is described here using Claude Code conventions (`.claude/agents/`, `.claude/hooks/`, `.claude/settings.json`, the `Task` tool for dispatch), but the same shape ports to the Agent SDK and other runtimes — only the wiring file names change.
