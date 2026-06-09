---
title: Worktrees
description: Per-workspace git worktrees — create, review against base, and squash-move work between them.
---

# Worktrees

A **worktree** is an extra checkout of the same repository on its own branch,
in its own directory, sharing one `.git`. aimux uses worktrees so you can run
several agents in parallel — each on its own branch in its own folder — without
them stepping on each other's files, lockfiles, or builds.

Worktrees belong to a [workspace](sessions.md): each workspace has a set of
worktrees, and every tab runs in one of them.

## The worktree set

Each workspace tracks three kinds of worktree:

- **primary** — the workspace's original checkout. Always present; can't be
  deleted.
- **aimux-temp** — created by aimux under `AIMUX_WORKTREE_ROOT` (default
  `/tmp/aimux-wt`, see [runtime paths](../reference/runtime-paths.md)). These are
  the ones aimux fully manages: it can create, move, and delete them.
- **external** — worktrees you created outside aimux that it discovered via
  `git worktree list`. aimux shows and uses them but won't delete them from disk.

## Creating a worktree

Worktrees are created from the **new-assistant modal** (`+ New assistant`, or
`Ctrl+N`):

1. Pick the assistant.
2. Press `Ctrl+W` to choose where the tab runs — an existing worktree, or
   **Create new worktree**.
3. For a new one, give it a name; the branch defaults to
   `aimux/<name>-<id>`. Press `Enter` to create the worktree and launch the
   assistant in it.

aimux confirms with a **Created worktree** toast.

## In the sidebar

Tabs are grouped by worktree. Each group has a colored header showing the
worktree's branch/name, and — for aimux-created worktrees — its divergence from
the branch it forked off:

```
┃ aimux/feature-x  ↑3 ↓1  ─────────
```

`↑` is commits ahead of the fork point, `↓` is commits behind. The primary and
externally-discovered worktrees don't record a fork point, so they show no
counts.

## Reviewing a worktree against its base

In [git mode](git-mode.md), press **`b`** to toggle **review vs base**. Instead
of the working-tree-vs-`HEAD` view, the pane shows everything the worktree has
changed since it branched off — its merge-base with the base ref through the
current working tree, i.e. commits **plus** staged and unstaged changes. The
file section and status bar read `vs <base>`.

This is exactly the set of changes a **move** will bring over, so reviewing here
matches what you'll land.

## Moving a worktree's changes

Move squashes everything a worktree changed since its fork point — commits,
staged, unstaged, and untracked — into another worktree's working tree, **staged
and uncommitted**. You then test it with a single dev server, review, and commit.

Two ways to start a move:

- **Git mode → `m`** — opens the move picker as an overlay on the git view.
- **Tab right-click → "Move worktree"** — moves that tab's worktree; opens the
  picker over the normal view (no git mode). Offered only when the tab's
  worktree has a branch and there's another worktree to land in.

In the picker:

| Key                  | Action                              |
| -------------------- | ----------------------------------- |
| `j` / `k`, `↑` / `↓` | Choose the target worktree          |
| `d`                  | Toggle **delete source after move** |
| `Enter`              | Run the move                        |
| `Esc`                | Cancel                              |

When the move succeeds, aimux switches you to the **target** worktree with the
changes staged, ready to review and commit, and shows a success toast. If
**delete source** was on, the source's terminals are closed and the worktree is
removed.

Safety:

- The **target must be clean** — a move into a dirty worktree is refused (so two
  change sets are never silently fused).
- On **conflict** the move aborts and leaves both worktrees untouched; nothing
  is lost. Resolve and retry.

## Removing a worktree

In the worktree picker (new-assistant modal), press `Ctrl+D` to delete the
highlighted worktree. aimux only removes **aimux-temp** worktrees from disk;
external worktrees are just dropped from the list, and the primary is protected.
Deleting a worktree closes the tabs running in it.

Moving with **delete source** is the other way a worktree gets removed — once
its work has landed in the target.
