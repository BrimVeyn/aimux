---
title: Git Mode
description: In-app review, diff view, stage, commit, and push workflow.
---

# Git Mode

Git mode is a dedicated in-app workflow for reviewing, staging, committing,
and pushing changes without leaving `aimux`.

Enter it with `Ctrl+D` from navigation. Exit with `Esc`.

## Overview

Git mode splits the screen into two regions:

- **Panel (left)** — file tree of the working copy, grouped into _Staged
  Changes_, _Changes_, and _Untracked_.
- **Diff view (right)** — the diff of the currently selected file, with
  syntax highlighting.

The active file is selected in the panel; the diff view follows.

## The Panel

Each row is either a folder or a file. Files show a status letter (`M`,
`A`, `D`, `R`, `C`, `U`, `?`) and, when available, numstat counters
(`+N −N`).

Folder rows and file rows use distinct text colors so the hierarchy is
visible at a glance.

Two list layouts are available and the choice is persisted per profile:

- `tree` — folders are collapsible, indentation reflects depth
- `flat` — one row per file, with the directory shown dimmed after the
  basename

Toggle between them with `t`.

## The Diff View

Two layouts:

- `stacked` (default) — classic unified diff with `+` / `−` gutters
- `split` — old on the left, new on the right, row-aligned

Toggle with `v`.

Unchanged context is progressively folded; the view auto-focuses on the
first change so reviewing a large file doesn't start from the top of an
unchanged prologue.

Syntax highlighting is provided by [shiki](https://shiki.style), using
the shiki theme variant bound to the active aimux theme, so the diff
colors stay consistent with the rest of the UI.

## Keybindings

Actions on the selected file:

| Key   | Action                                           |
| ----- | ------------------------------------------------ |
| `a`   | Stage                                            |
| `d`   | Unstage / delete (two-press for destructive ops) |
| `c`   | Open the commit modal                            |
| `p`   | Push                                             |
| `v`   | Toggle split / stacked diff                      |
| `t`   | Toggle flat / tree list                          |
| `]`   | Older commit (HEAD~N → N+1)                      |
| `[`   | Newer commit (HEAD~N → N-1)                      |
| `?`   | Help (scoped to git mode)                        |
| `Esc` | Exit git mode                                    |

Navigation in the panel:

- `j` / `k` — next / prev entry (files and folders)
- `Ctrl+N` / `Ctrl+P` — next / prev file (skips folders)
- `h` / `l` — toggle the selected folder
- `Left` / `Right` — collapse / expand the selected folder

Diff view scroll and layout:

- `Down` / `Up` — scroll one line
- `Ctrl+D` / `Ctrl+U` — page down / page up
- `Ctrl+L` — widen the file-bar pane
- `Backspace` / `Ctrl+H` — narrow the file-bar pane

The destructive `d` requires two presses on unstaged or untracked files
(the first arms the action, the second confirms) to prevent accidental
data loss.

## Walking History

`]` and `[` shift a `HEAD~N` offset. At `N=0` (default) the panel shows the
usual Staged / Changes / Untracked split against `HEAD`. At `N>0` the panel
collapses into a single **HEAD~N** section listing every file that differs
between `HEAD~N` and the working tree; the diff view and binary
detection use `HEAD~N` as the baseline, and untracked files still appear
since they aren't in any commit.

While the offset is non-zero:

- `a` / `d` / `c` / `p` are disabled and surface a one-line message; the
  status-bar footer drops them from its hint list so you see only the keys
  that actually do something.
- The current offset is shown above the panel (`HEAD~N · [ newer · ] older`)
  and next to the session label in the status bar.
- Pressing `]` past the oldest available commit clamps the offset and shows
  `no older commit — clamped to HEAD~N`.

Leaving git mode (`Esc`) resets the offset back to `0`.

## Help Modal

Press `?` inside git mode to open a help modal scoped to git-mode
bindings. The modal renders as an overlay on top of the git view: the
selection, scroll position, split / stacked toggle, and fold state all
stay intact behind it, and closing with `Esc` returns you to exactly
where you left off.

The same `?` in navigation mode opens the full help modal with every
mode listed.

## Commit Flow

`c` opens a two-field commit modal:

- `title` — subject line
- `body` — optional longer description

`Tab` switches fields. Submitting the form runs `git commit`; `Esc`
cancels and returns to git mode.

`p` pushes the current branch.

## Multi-repo Workspaces

When a session's `projectPath` contains nested git repositories — for
example a workspace folder holding several sibling repos — aimux discovers
them automatically and aggregates their status into a single git panel.

### What you see

- Every changed file from every discovered repo is listed inside the same
  Staged / Changes / Untracked sections.
- Within each section, files are grouped by repo first and by path second,
  so all of `api/`'s changes stay together before `web/`'s.
- In **flat** list mode (`t`), each file gets a short disambiguating prefix
  between the status letter and the path. Prefixes use just the first
  letter of the sub-repo name, extended to 2 or 3 letters only when needed
  to stay unique:

  ```text
  M a src/server.ts          ← from `api/`
  M a src/middleware.ts      ← from `api/`
  M w src/app.tsx            ← from `web/`
  ```

  If the session's top-level directory is itself a repo, its files have no
  prefix and appear first.

- **Tree** mode keeps the normal path hierarchy — the sub-repo folders
  naturally group their files, so no extra prefix is shown.

### What it changes

- Stage / unstage / discard / commit / diff all route to the right repo
  for the selected file — no manual `cd` required.
- The branch label above the panel reflects the root repo's branch (or the
  first discovered sub-repo when the root isn't a repo).
- Walking history with `]` / `[` targets the root/fallback repo: `HEAD~N`
  across disparate repos doesn't compose cleanly, so history view reverts
  to a single-repo view while the offset is non-zero.

### Configuration

Multi-repo is **enabled by default** with a depth of 1. To change the depth
or turn it off, set `multiRepo` in `aimux.config.ts`:

```ts
import { defineConfig } from '@brimveyn/aimux-config'

export default defineConfig({
  multiRepo: {
    enabled: true, // default: true
    maxDepth: 1, // default: 1 (direct children only)
  },
})
```

- `maxDepth: 1` scans the direct children of `projectPath`. Use `2` (or
  more) to descend further for deeply nested layouts.
- Discovery is performed **once per session** (cached by `projectPath` +
  `maxDepth`) so opening a workspace with many repos remains cheap.
- Directory names starting with `.` and common build directories
  (`node_modules`, `target`, `dist`, `build`) are skipped.

Set `enabled: false` to fall back to the single-repo behaviour: only
`projectPath` itself is polled, no prefix is shown, no discovery runs.

## Auto-commit

Auto-commit is an **opt-in** feature that uses an AI assistant (Claude
Haiku by default) to write commit messages for you in the background.
It is **disabled by default** — enable it in your config (see below).

### What it does

While auto-commit is enabled, the commit modal grows an extra
**`[ Auto-commit ]`** button (also bound to `Ctrl+A` inside the modal).

In parallel, a background driver watches your working tree and
pre-generates a suggestion whenever the tree has been stable for ~2 s and
there are changes to summarise. Reading the current `git diff`, the last
five commits (for style), the branch name, and a tail of your assistant's
terminal session, it asks the configured model for a structured
`TITLE:` + `BODY:`. The result is cached for the current hash of your
working tree.

Clicking `[ Auto-commit ]` (or pressing `Ctrl+A`) in the commit modal:

- with an **empty** title, **uses the cached suggestion** if one is
  ready — no new request. If generation is still running, the loading
  overlay takes over until it completes, then flips to confirmation with
  the fields filled in.
- with a title you've **typed yourself**, just jumps to the confirmation
  step with your text.

A small braille spinner (`⠋⠙⠹…`) appears next to the button label while
a background generation is in flight.

### Manual staging is respected

If you have **already staged files** (via `git add` or `a` in git mode),
auto-commit only looks at — and only commits — that staged set. The
confirm step shows _"Commit will include the N staged file(s) only."_
If **nothing is staged**, auto-commit runs `git add -A` before
committing, matching the "just write a message for everything" intent.

### Invalidation & re-generation

The cached suggestion is keyed on a hash of your working tree that
includes each file's path, status, line counts, **and** staged/unstaged
section. Any of these changing (including `git add` / `git reset HEAD`)
invalidates the suggestion and schedules a new generation after ~2 s of
stability.

### Enabling it

In your `aimux.config.ts`:

```ts
import { defineConfig } from '@brimveyn/aimux-config'

export default defineConfig({
  autoCommit: {
    enabled: true, // default: false
    // optional — override the model per provider
    models: {
      claude: 'claude-haiku-4-5',
      codex: 'gpt-5-mini',
    },
    // optional — kill the headless call if it takes longer than this (ms)
    timeoutMs: 60_000,
  },
})
```

When `enabled` is `false` (the default), the `[ Auto-commit ]` button is
hidden, `Ctrl+A` surfaces a one-line status message pointing you to the
config, no background requests run, and the regular commit flow
(`Ctrl+Enter` to commit staged) still works as normal.

### Supported providers

Only assistants with a headless-CLI mode are supported:

- `claude` (Claude Code CLI)
- `codex` (Codex CLI)
- `opencode`

The active tab's assistant determines which CLI is called; if the
assistant has no headless form, auto-commit stays silent.

## Status Bar

While in git mode, the status bar shows the main action keys on the left
and `? Help` right-aligned (next to the version), so the two surfaces
you need during review stay one glance apart.

## References

The review ergonomics in git mode — the side-by-side diff, progressive
context folding, and the focus on the first change — were directly
inspired by [Pierre — diffs.com](https://diffs.com).

Syntax highlighting is powered by [shiki](https://shiki.style).
