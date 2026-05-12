# 09 — Memory System

The orchestrator's conversation context disappears at the end of a session. Anything load-bearing has to live outside the conversation. The framework recognizes four kinds of memory; each kind has a home.

## The four memory types

### 1. Project memory

What it is: facts about the project that don't change often — architecture, key paths, deployment setup, conventions.

Where it lives: `CLAUDE.md` at the repo root, plus optional `project_*.md` files in the user-level memory directory.

Example entries:

```
- The web package uses Next.js 15 App Router on Cloudflare Pages.
- All routes must use `export const runtime = "edge"`.
- Catalog ID format: `{country}-{store}-{isoDateFrom}-{isoDateTo}`.
- Tests run via `bun test` from each package directory.
```

Project memory is the first thing the orchestrator should consult when planning. Keep it concise — long `CLAUDE.md` files train the model to skim.

### 2. Feedback memory

What it is: corrections from the user that should apply to all future work. "Don't add Co-Authored-By to commits." "Always ask before pushing." "Correct my English when I use voice mode."

Where it lives: `feedback_*.md` files in the user-level memory directory, indexed from `MEMORY.md`.

Example entries:

```
# feedback_no_coauthor.md
The user does not want "Co-Authored-By" trailers in commit messages. Never add them.

# feedback_no_push.md
Never push to remote without explicit "yes" from the user. Asking once does not authorize subsequent pushes.
```

Each feedback file is one rule. The orchestrator pulls them at session start and treats them as hard constraints. They are not "preferences" — they are corrections the user already had to make once and does not want to make again.

### 3. Reference memory (knowledge base)

What it is: facts the team learned while working — gotchas, library behaviors, environment quirks. The output of `LEARNED:` comments on beads.

Where it lives: `.beads/memory/knowledge.jsonl` inside the repo (one JSONL entry per learning, populated by the `memory-capture.sh` hook).

Example entries:

```json
{"key":"learned-iso-weeks-locale","type":"learned","content":"ISO weeks depend on locale in some JS runtimes; use Temporal API or explicit UTC.","source":"agent","ts":1716000000,"bead":"proj-42"}
{"key":"learned-cf-pages-build-cache","type":"learned","content":"Cloudflare Pages does not cache node_modules across builds unless explicitly enabled in dashboard.","source":"agent","ts":1716100000,"bead":"proj-15"}
```

Reference memory grows naturally over time. The `session-start.sh` hook shows the most recent entries. The orchestrator can grep the file when planning related work.

### 4. User memory

What it is: facts about the user — name, role, communication style, preferences that aren't strict rules.

Where it lives: user-level config (outside the repo). On Claude Code, this is `~/.claude/projects/{project-id}/memory/MEMORY.md` and adjacent files.

Example entries:

```
- The user is a senior engineer working solo on this project.
- The user often uses voice input, which produces minor grammar errors — correct them silently.
- The user prefers short, declarative responses over hedged ones.
```

User memory is not committed to the repo; it follows the user across projects.

## What to put where

| Information | Project | Feedback | Reference | User |
|-------------|---------|----------|-----------|------|
| Build commands | yes | | | |
| Architecture overview | yes | | | |
| "Always ask before push" | | yes | | |
| "Never use AWS SDK in web pkg" | yes | | | |
| Library X has a bug in v3.2 | | | yes | |
| User's preferred response style | | | | yes |
| Path conventions | yes | | | |
| Active project status | yes | | | |
| One-off task notes | (use beads) | | | |

When in doubt: project memory is for "always true," feedback is for "user told me to," reference is for "we discovered," user is for "this person."

## What never goes in memory

A few things should never end up in any memory file:

- **Secrets.** API keys, passwords, tokens. Use environment variables and a secrets manager.
- **Code patterns or large code snippets.** Memory is for facts and decisions, not source. If you need code, link to the commit or file.
- **Ephemeral state.** What the orchestrator was about to do, what the last test run looked like. That belongs in the conversation or on a bead, not in memory.
- **Stale status.** "We are working on X right now." Put that on a bead with `in_progress` status. Status in memory goes wrong the moment the work changes.
- **Personal data about third parties.** Names, emails, addresses of people unrelated to the project. Avoid by default.

## The MEMORY.md index

The user-level memory directory typically has many small files. A single `MEMORY.md` at the directory root is the index, listing each file with a one-line summary:

```markdown
# Project Memory Index

## Overview
{1-2 paragraphs about the project}

## Architecture
{key facts}

## Feedback
- [No Co-Authored-By](feedback_no_coauthor.md) — don't add Co-Authored-By
- [No Push Without Permission](feedback_no_push.md) — ask before pushing
- [Small Focused Commits](feedback_small_commits.md) — one commit per change

## Active Projects
- [Feature X](project_feature_x.md) — status: in progress
- [Migration Y](project_migration_y.md) — status: done
```

The orchestrator loads `MEMORY.md` first, then opens individual files when relevant. This keeps the initial context cost low while making detailed memory available on demand.

## When to update vs add new

Update an existing memory entry when:

- The fact has changed (architecture moved, command renamed).
- A feedback rule has a new edge case the user wants captured.

Add a new memory file when:

- A new project starts and needs its own status doc.
- A new feedback rule emerges that doesn't fit existing files.
- A learning is structured enough to deserve its own document (rare — most learnings go into `knowledge.jsonl`).

Avoid duplicating. If a fact is in `CLAUDE.md`, it does not also belong in `MEMORY.md`. The orchestrator reads both — duplication wastes context and creates drift when only one copy gets updated.

## Auto-memory vs explicit memory

Some runtimes auto-summarize sessions into a memory file. Treat these auto-summaries as observations, not ground truth. The session-start hook prints a "memories are point-in-time" warning for this reason. When an auto-summary says something specific (file paths, line numbers, behavior claims), verify against the current code before acting on it.

Explicit memory entries — the ones you or the orchestrator write deliberately — are more reliable. Keep them concise and use them for facts that are unlikely to change.

Next: [10-setup-guide.md](./10-setup-guide.md) is the recipe for applying this framework to a new project.
