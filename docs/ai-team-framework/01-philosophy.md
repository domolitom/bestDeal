# 01 — Philosophy

The framework rests on four design choices. Each one is a reaction to a specific failure mode that shows up when you let a single general-purpose agent loose on a non-trivial project.

## One orchestrator plus N supervisors

A flat pool of generalist agents creates three problems. First, each new dispatch has no idea what the previous one looked at, so context rebuilds from zero. Second, when something goes wrong it is hard to know which agent made which decision, because they were all running with the same prompt. Third, the user ends up doing the coordination work that the agent was supposed to handle.

The orchestrator-supervisor split fixes this. One agent — the orchestrator — owns the conversation with the user. It investigates with read-only tools, drafts a plan, gets confirmation, and then dispatches work to supervisors. Each supervisor is scoped to a single domain (frontend, backend, infrastructure, etc.) and has the tools needed to work in that domain and nothing else.

The user only talks to the orchestrator. The orchestrator only writes through supervisors. Supervisors only touch their own domain. This produces a clear chain of authority and a clear audit trail.

Example shape:

| Layer | Who | Reads | Writes |
|-------|-----|-------|--------|
| Top | User | conversation | requirements |
| Middle | Orchestrator | repo, plans, beads | beads, plans, dispatches |
| Bottom | Supervisor | repo subset | code in their domain |

## Named characters with personalities

Every supervisor in the framework has a name and a short personality blurb at the top of its definition. This is not a gimmick. Three concrete benefits:

1. **Continuity across sessions.** When the orchestrator's memory says "Harmony fixed the edge-runtime bug last Thursday," the user and the agent share a referent that survives across compactions and new conversations. Saying "the web supervisor" doesn't compress as well.
2. **Role clarity.** A code reviewer called "Nitpick" who is described as "finds every flaw" produces stricter reviews than a code reviewer with no character. The persona acts as a low-cost prompt amplifier for the role.
3. **Memorability in conversation.** Users can ask the orchestrator "did Nico ever look at the Lidl flow?" — the name turns the team into a thing you can think about, not a list of agent IDs.

Keep personalities short — one or two lines. They are a signal to the model, not a creative writing exercise.

## A git-native issue tracker

Every task gets a bead before any supervisor is dispatched. The bead is the unit of work: it has an ID, a title, a description, a status, and a comment thread that captures dispatch prompts and learnings.

Why a tracker that lives in git, rather than a web tool or a markdown file:

- **Shared across sessions.** Beads survive when the conversation context does not. A new session starts knowing what's in flight.
- **Shared across agents.** Supervisors update their own bead status. The orchestrator queries `bd ready` to find work without reading the whole repo.
- **Programmatic.** Hooks can refuse a dispatch that doesn't reference a bead. The system can enforce its own conventions.
- **No external service.** No tokens, no rate limits, no UI to log into.

The framework uses `bd` (beads) as the canonical implementation. The pattern works with any CLI-driven tracker as long as it supports create, comment, status updates, and listing of ready work.

## Deterministic guardrails via hooks

Prompts are persuasion. Hooks are enforcement. When the orchestrator says "I'll work on a feature branch" and then edits `main` anyway, you have a problem that no amount of polite reminders will fix. A pre-tool hook that returns `{"permissionDecision": "deny"}` for `Edit` calls on `main` makes the same mistake structurally impossible.

The framework ships with six hooks (see [06-hooks-guardrails.md](./06-hooks-guardrails.md)). Each one enforces a single invariant:

- The orchestrator cannot edit code outside `.claude/`, plans, and memory.
- Supervisors cannot be dispatched without a bead.
- Every dispatch is logged to its bead.
- `LEARNED:` comments are written to a searchable knowledge file.
- Each session opens with the current task board.
- Supervisor completions are rejected if the worktree has uncommitted changes.

When a new invariant emerges, add a hook. Do not add a paragraph to `CLAUDE.md`.

## Anti-patterns

A few patterns to avoid:

- **The single mega-agent.** One agent with every tool, no role boundaries, and a 5000-line system prompt. It works for a week, then drifts.
- **Ad-hoc dispatch.** Dispatching supervisors without a bead. Loses the audit trail and breaks anything that depends on a bead ID, including the worktree path.
- **Edits on the main branch.** Tempting for "trivial" changes. Stops being trivial when three trivial changes collide. The block-orchestrator hook prevents it.
- **One supervisor per file.** Supervisors are scoped by domain, not by file. A web supervisor handles the whole web package; do not split it into "react supervisor" and "css supervisor."
- **Personality without scoping.** Adding a name and a quirk to an agent does nothing if its tools and domain aren't also restricted. Personality is the cherry; scoping is the cake.
- **Hidden memory in the orchestrator's head.** If the orchestrator "knows" the project layout from prompt context only, the next session won't. Anything load-bearing belongs in `CLAUDE.md`, the memory directory, or a bead.

Next: [02-orchestrator.md](./02-orchestrator.md) explains the orchestrator's loop in detail.
