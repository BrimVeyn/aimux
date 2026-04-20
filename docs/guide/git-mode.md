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

## Status Bar

While in git mode, the status bar shows the main action keys on the left
and `? Help` right-aligned (next to the version), so the two surfaces
you need during review stay one glance apart.

## References

The review ergonomics in git mode — the side-by-side diff, progressive
context folding, and the focus on the first change — were directly
inspired by [Pierre — diffs.com](https://diffs.com).

Syntax highlighting is powered by [shiki](https://shiki.style).
