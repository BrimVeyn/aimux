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

Press `Ctrl+P` to open the **New workspace** modal. It asks one question —
_What do you want to work on?_ — and derives the rest from your answer:

1. Describe the work. The base defaults to the repository's default branch
   (`origin/HEAD`, falling back to `main` or `master`); `Tab` switches to it if
   you want to fork from somewhere else.
2. Press `Enter`. If the project declares [templates](#templates) you pick one
   first; otherwise the workspace is created straight away.
3. Without a template, the assistant picker opens on the new workspace.
   `Terminal` is not offered there — a shell cannot take your prompt. With a
   template, its tabs start instead.
4. Your prompt is pasted into the assistant and submitted as soon as it is
   ready, so the workspace starts working on its own.

aimux confirms with a **Created workspace** toast.

### Naming

The workspace and its branch are both named after your prompt.

A name derived locally from the prompt appears immediately, so the sidebar
never reads `wt-myrepo`. In the background the assistant you picked generates a
better one; when it lands, the workspace is renamed on screen **and** its branch
is renamed with `git branch -m`. The directory under `AIMUX_WORKTREE_ROOT` keeps
its original slug — git registers worktrees by absolute path, so renaming the
directory would orphan them.

If no headless CLI is available, or the model call fails or times out, the local
name simply stays. Nothing is retried and nothing is reported: it is already a
name derived from what you asked for.

`Ctrl+N` never creates a workspace — it only opens a tab in the workspace you
are already in.

## Working in the repo checkout

The **primary** workspace is the repository checkout, and it hosts tabs like
any other. `Ctrl+N` there opens an assistant in the repo directory itself.

That is deliberate, because a worktree is not free. `git worktree add` checks
out the _tracked_ files and nothing else: no `.env`, no `node_modules`, no
`.venv`, no build cache, no local database. A setup step can regenerate some of
that and can never regenerate a secret. On plenty of repos the isolation buys
less than it costs, and those repos should not have to pay for it.

So `Ctrl+P` is an offer, not a toll gate: it is the short path to an isolated
branch when you want one — one keystroke, worktree created, assistant started
on your prompt — and the default that keeps parallel agents from colliding.
It is not the only way in.

Opening a project selects one of its workspaces, falling back to the primary
only when the project has none.

## Setup script

The setup step above is a real thing, one script per project:

```text
~/.config/aimux/<profile>/projects/<projectId>/setup.sh
```

It lives outside the repository on purpose. A file at the repo root would only
reach a worktree if it were committed, and a setup script is usually the kind of
thing you do not want to commit. Living in aimux's own directory, one script
serves every workspace of the project — and it runs with the working directory
set to the workspace, so it must use relative paths.

It runs automatically when a workspace is **created**, and never otherwise. Not
when a workspace is merely selected: `j`/`k` cycles workspaces, and a rule keyed
on selection would fire an install in every workspace you scrolled past. The
primary workspace is also excluded — it is your real checkout, and a script that
does `cp .env.example .env` has no business running over it.

Both creation paths are covered, the TUI's `Ctrl+P` and `aimux workspace create`.
A workspace created by the CLI while aimux is closed is the one gap; run it by
hand from the widget.

Write it so it can be run twice in a row, and so it never blocks on a human. A
non-zero exit is reported as a toast and recorded on the workspace.

### The setup widget

The **Setup** widget is where the script lives in the UI. It ships hidden —
right-click a bar and pick "Show Setup" to place it.

With no script yet, it offers two buttons. **Configure** creates an executable
stub and opens it in your `$EDITOR` (the same editor path the git pane and
snippet picker use). **Ask an agent** creates the stub, then opens the assistant
picker with a prompt describing what the script has to do; the assistant you
pick inspects the repo and writes it.

Once a script exists, the widget shows the run state for the current workspace —
`running…`, `✓ setup ok`, or `✗ exit N` — with the live output underneath, plus
**Run** / **Re-run**, **Edit**, and **↗**.

That last one matters. The setup PTY is a real tab, but a hidden one: it is not
in the tab bar, `Ctrl+Tab` skips it, and it is never restored from a snapshot.
**↗** promotes it into a normal tab in the main pane, because reading a stack
trace in a bar thirty columns wide is not reading.

A `Ctrl+P` workspace runs its setup and its assistant at the same time. The
assistant's prompt is prefixed with a note saying so, so it knows to wait before
running builds or tests.

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

When at least one template is loaded, `Ctrl+P` inserts a template picker
between the prompt and creation. The template spawns its own tabs, so the
assistant picker is skipped — and with it the prompt hand-off and the
model-generated name: a templated workspace keeps the name derived locally
from your prompt.

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

Each project is a heading, and every one of its workspaces gets a row beneath
it — the repo checkout included, listed as **root**. A row is two lines: the
workspace's name, with its branch under it, and the churn since its fork point
on the right.

```
• aimux                                    +
    root
      main
    scroll drift fix                 +142 -37
      aimux/scroll-drift-fix
```

The heading is not a place the cursor stops. `j` / `k` move between workspace
rows; clicking a heading takes you to that project's **root**.

The churn counts come from a fork point, which only aimux-created workspaces
record — **root** and externally-discovered workspaces show none.

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
