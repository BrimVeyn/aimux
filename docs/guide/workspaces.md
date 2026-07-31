---
title: Workspaces
description: Per-project git worktrees — create, review against base, and squash-move work between them.
---

# Workspaces

A **workspace** is an extra checkout of the same repository on its own branch,
in its own directory, sharing one `.git`. aimux uses workspaces so you can run
several agents in parallel — each on its own branch in its own folder — without
them stepping on each other's files, lockfiles, or builds.

Workspaces belong to a [project](projects.md): each project has a set of
workspaces, and every tab runs in one of them.

## The workspace set

Each project tracks three kinds of workspace:

- **primary** — the project's original checkout. Always present; can't be
  deleted.
- **aimux-temp** — created by aimux under `AIMUX_WORKTREE_ROOT` (default
  `/tmp/aimux-wt`, see [runtime paths](../reference/runtime-paths.md)). These are
  the ones aimux fully manages: it can create, move, and delete them.
- **external** — workspaces you created outside aimux that it discovered via
  `git worktree list`. aimux shows and uses them but won't delete them from disk.

## Creating a workspace

Press `Ctrl+P` to open the **New workspace** modal:

1. Give it a name. The branch defaults to `aimux/<name>-<id>`, and the base
   defaults to the active workspace's branch — `Tab` cycles the three fields.
2. Press `Enter`. If the project declares [templates](#templates) you pick one
   first; otherwise the workspace is created straight away.
3. Without a template, the new-tab modal opens on the new workspace so you can
   pick an assistant. With a template, its tabs start instead.

aimux confirms with a **Created workspace** toast.

`Ctrl+N` never creates a workspace — it only opens a tab in the workspace you
are already in.

## Templates

A **workspace template** is a reusable layout — one or more tabs, each with
one or more split panes, and optional commands typed into each pane — that
spawns automatically when you create a workspace. Use them to stamp out the
same dev environment (assistant + lint watcher + dev server + …) every time
you start work on a new branch.

Templates are declared in `aimux.config.ts`:

```ts
import { defineConfig } from '@brimveyn/aimux-config'

export default defineConfig({
  workspaceTemplates: [
    {
      id: 'rainpath',
      name: 'Rainpath',
      description: 'Claude + a shell with git status',
      tabs: [
        {
          panes: [{ id: 'main', assistant: 'claude' }],
        },
        {
          panes: [{ id: 'shell', assistant: 'terminal', send: 'git status' }],
        },
      ],
    },
  ],
})
```

They can also live in `aimux.json` under the same key (JSON form, same
schema) — the TS config wins when both define `workspaceTemplates`.

When at least one template is loaded, the new-tab flow gains a final
**Step 4/4 — choose template** step after workspace-create. Pick `None` to
keep the single-pane behaviour (the assistant you picked at Step 1 becomes
the workspace's only pane); pick a template to spawn its full layout.

### Skipping the assistant pick

When you're going to use a template, the assistant chosen at Step 1 is
irrelevant — the template defines its own panes. The bottom of the
Step 1 assistant picker therefore shows an extra entry:

```
Workspace from template…
  Create a workspace and pick a template — no assistant step
```

Pick it (or click it) to jump straight to the workspace-name form, then to
the template picker. `None` is hidden in that picker because no assistant
was chosen as a fallback.

### Schema

A template is a top-level object plus an ordered list of tabs:

| Field         | Required | Notes                               |
| ------------- | -------- | ----------------------------------- |
| `id`          | yes      | unique among templates              |
| `name`        | yes      | label shown in the picker           |
| `description` | no       | subtitle shown in the picker        |
| `tabs[]`      | yes      | ≥ 1 tab; each becomes a top-bar tab |

Each tab is just `{ panes: WorkspaceTemplatePane[] }` with ≥ 1 pane. The
first pane of a tab is its root (the visible pane); subsequent panes are
splits of a previous pane in the same tab.

| Pane field  | Required        | Notes                                                                                                       |
| ----------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`        | yes             | unique within its tab; referenced by `splitFrom`                                                            |
| `assistant` | yes             | `claude`, `codex`, `opencode`, `grok`, `kimi`, `antigravity`, `terminal`, `shell`, or any custom command id |
| `splitFrom` | only after root | id of an earlier pane in the **same** tab                                                                   |
| `direction` | only after root | `horizontal` (side-by-side) or `vertical` (top/bottom)                                                      |
| `ratio`     | no              | fraction of space taken by the **new** pane, between 0.15 and 0.85                                          |
| `send`      | no              | initial input typed into the pane shortly after spawn; newline appended automatically                       |

`'shell'` is accepted as an alias for the built-in `'terminal'` assistant
(which spawns `$SHELL`).

### Validation

Every template is parsed through the same checks at load time. Invalid
entries are dropped individually and logged via the [doctor](../reference/cli.md);
the rest of the config keeps loading. Validation rejects:

- empty `id`, `name`, or `tabs[]`
- empty `panes[]` inside a tab
- a root pane that declares `splitFrom`, `direction`, or `ratio`
- a non-root pane missing `splitFrom`/`direction`, or referencing a pane
  in another tab (or itself)
- duplicate pane `id`s within the same tab
- `direction` other than `horizontal` or `vertical`
- `ratio` outside `(0.15, 0.85)`
- duplicate template `id`s (the second occurrence is dropped)

### Caveats

- `send` is fired ~600 ms after the pane is spawned. That's enough for
  shells (which print a prompt within ~100 ms) but can race with slower
  AI CLIs — prefer `send` on terminal panes.
- Templates only fire on new-workspace creation, not when aimux restarts
  or reattaches to an existing workspace.

## In the sidebar

Tabs are grouped by workspace. Each group has a colored header showing the
workspace's branch/name, and — for aimux-created workspaces — its divergence from
the branch it forked off:

```
┃ aimux/feature-x  ↑3 ↓1  ─────────
```

`↑` is commits ahead of the fork point, `↓` is commits behind. The primary and
externally-discovered workspaces don't record a fork point, so they show no
counts.

## Reviewing a workspace against its base

In [git mode](git-mode.md), press **`b`** to toggle **review vs base**. Instead
of the working-tree-vs-`HEAD` view, the pane shows everything the workspace has
changed since it branched off — its merge-base with the base ref through the
current working tree, i.e. commits **plus** staged and unstaged changes. The
file section and status bar read `vs <base>`.

This is exactly the set of changes a **move** will bring over, so reviewing here
matches what you'll land.

## Moving a workspace's changes

Move squashes everything a workspace changed since its fork point — commits,
staged, unstaged, and untracked — into another workspace's working tree, **staged
and uncommitted**. You then test it with a single dev server, review, and commit.

Two ways to start a move:

- **Git mode → `m`** — opens the move picker as an overlay on the git view.
- **Tab right-click → "Move workspace"** — moves that tab's workspace; opens the
  picker over the normal view (no git mode). Offered only when the tab's
  workspace has a branch and there's another workspace to land in.

In the picker:

| Key                  | Action                              |
| -------------------- | ----------------------------------- |
| `j` / `k`, `↑` / `↓` | Choose the target workspace         |
| `d`                  | Toggle **delete source after move** |
| `Enter`              | Run the move                        |
| `Esc`                | Cancel                              |

When the move succeeds, aimux switches you to the **target** workspace with the
changes staged, ready to review and commit, and shows a success toast. If
**delete source** was on, the source's terminals are closed and the workspace is
removed.

Safety:

- The **target must be clean** — a move into a dirty workspace is refused (so two
  change sets are never silently fused).
- On **conflict** the move aborts and leaves both workspaces untouched; nothing
  is lost. Resolve and retry.

## Removing a workspace

In the workspace picker (new-assistant modal), press `Ctrl+D` to delete the
highlighted workspace. aimux only removes **aimux-temp** workspaces from disk;
external workspaces are just dropped from the list, and the primary is protected.
Deleting a workspace closes the tabs running in it.

Moving with **delete source** is the other way a workspace gets removed — once
its work has landed in the target.
