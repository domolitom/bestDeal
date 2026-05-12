# 07 — Worktree Isolation

Implementation supervisors do not work in the main checkout. They each create a git worktree under `.worktrees/bd-{BEAD_ID}/`, do their work there, commit on a dedicated branch, and push. The orchestrator merges or asks the user to merge.

## What a worktree is

`git worktree` is a built-in git feature that lets multiple working directories share a single `.git` directory. Each worktree has its own checked-out branch, its own index, and its own untracked files. They are first-class siblings of the main checkout.

```bash
# Create a worktree
git worktree add .worktrees/bd-42 -b bd-42

# The directory .worktrees/bd-42 now contains a checkout on branch bd-42
# while the main directory stays on master.
```

Cleanup when done:

```bash
git worktree remove .worktrees/bd-42
git branch -D bd-42  # if you don't want to keep the branch around
```

## Why worktrees for supervisors

Three reasons:

### 1. Parallel work without conflicts

Two supervisors dispatched in parallel both want to edit files. If they share a working directory, the second one sees the first one's half-written state and gets confused — or worse, commits over it. With a worktree per bead, each supervisor has its own filesystem view.

```
main checkout            .worktrees/bd-42/         .worktrees/bd-43/
  on master                on bd-42                  on bd-43
  (orchestrator reads)     (web supervisor edits)    (backend supervisor edits)
```

Each supervisor's commits go on its own branch. When both finish, the orchestrator can merge them into master in either order (assuming the changes don't actually conflict at the file level — see [08-parallel-patterns.md](./08-parallel-patterns.md) for conflict prediction).

### 2. The main branch stays clean

The block-orchestrator-tools hook denies edits on `main`/`master`. Without worktrees, the supervisor would have to switch the main checkout to a feature branch, make edits, switch back. With worktrees, the main checkout stays on master, ready for inspection or another dispatch.

This matters most when a session is interrupted. The user can drop in, run `git status` on the main checkout, and immediately see the master state — not whatever feature branch a supervisor was midway through.

### 3. Atomic units of work

A bead has an ID. A worktree has the same ID baked into its path (`.worktrees/bd-42/`). A branch has the same ID (`bd-42`). The validate-completion hook checks for uncommitted changes in `.worktrees/bd-${BEAD_ID}/`. The whole chain — bead, worktree, branch — moves together.

If you abandon a bead, you remove its worktree and delete its branch. If you complete it, you merge the branch and remove the worktree. There is no half-state to clean up.

## Cleanup patterns

Three lifecycle moments to handle:

**On supervisor completion (happy path):**

```bash
# Orchestrator side after review and merge
git worktree remove .worktrees/bd-42
git branch -d bd-42  # safe delete; refuses if not merged
```

**On supervisor abandonment:**

```bash
# Supervisor decides the work cannot be completed
bd update {ID} --status blocked
bd comment {ID} "Abandoned: <reason>"
# Orchestrator removes the worktree
git worktree remove --force .worktrees/bd-42
git branch -D bd-42  # force delete since not merged
```

**On stale worktrees:**

Sometimes a session ends mid-flight and leaves a worktree behind. List and prune:

```bash
git worktree list
git worktree prune  # removes administrative records of deleted worktree paths
```

A daily housekeeping habit: at the start of a session, the orchestrator can run `git worktree list` and reconcile against `bd list --status in_progress`. Any worktree whose bead is closed gets removed. Any in-progress bead without a worktree gets a fresh worktree on the next dispatch.

## When worktree isolation breaks down

A few failure modes to know about.

### Runtime auto-merges back to main worktree

Some agent runtimes manage their own worktree state and auto-sync changes back to the main checkout. If you see edits appearing in the main directory after a supervisor commit, your runtime is doing this. Two options:

- Disable the runtime's worktree management and rely on plain `git worktree`.
- Adapt the validate-completion hook to look at the runtime's path instead of `.worktrees/bd-{ID}`.

### Worktree on a non-existent branch

If `git worktree add` fails (branch already exists, no permission, full disk), the supervisor will report a step-3 failure. Treat this as a hard stop — do not let the supervisor proceed in the main checkout as a fallback. The audit trail depends on the worktree existing.

### Cross-worktree references

A supervisor in `.worktrees/bd-42/` cannot easily inspect what another supervisor is doing in `.worktrees/bd-43/`. This is by design — they should not be looking at each other's in-flight work. If two beads genuinely need to share intermediate state, they should be merged into one bead, or split with a dependency in `bd`.

### Disk usage

Each worktree is a full checkout. On a large repo, twenty open worktrees is a lot of disk. The cleanup discipline above keeps this in check. If you find old worktrees accumulating, add a hook or scheduled job that prunes worktrees for closed beads.

## Worktree path conventions

The framework uses `.worktrees/bd-{BEAD_ID}/` as the canonical pattern. The choice is:

- **`.worktrees/`** as the parent — single hidden directory, easy to gitignore.
- **`bd-{ID}`** as the name — matches the branch name, so `git branch | head` and `ls .worktrees/` produce parallel listings.

Add `.worktrees/` to `.gitignore`:

```
.worktrees/
```

This prevents nested worktree contents from showing up in the main checkout's status. The worktrees themselves are still tracked by git's internal worktree mechanism — `.gitignore` only affects file visibility.

## A note on remote pushes

Each worktree's branch should be pushed to the remote when the supervisor commits. This makes the work visible to the user (who can review on GitHub, GitLab, etc.) and gives the orchestrator a real merge target.

```bash
# Inside .worktrees/bd-42 after committing
git push -u origin bd-42
```

The remote branch is the supervisor's deliverable. The local worktree is just the working space.

Next: [08-parallel-patterns.md](./08-parallel-patterns.md) covers when and how to dispatch multiple supervisors at once.
