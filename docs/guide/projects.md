---
title: Projects
description: Project picker, project creation, persistence, reorder, and reconnect behavior.
---

# Projects

Projects are the top-level concept in `aimux`. A project is a repository you
add by picking a folder; inside it live [workspaces](workspaces.md) (git
worktrees), and inside those live tabs.

Each level has exactly one creation action:

| Level     | Action                           |
| --------- | -------------------------------- |
| project   | `Ctrl+G` -> "Create new project" |
| workspace | `Ctrl+P`                         |
| tab       | `Ctrl+N`                         |

Each project can have:

- a name
- an optional `projectPath`
- an order in the project list
- a persisted project snapshot
- a set of [workspaces](workspaces.md) for running agents on parallel branches

That snapshot contains the project's tabs, layout, some sidebar state, and the
last known terminal viewport / scroll anchor for each tab.

## Startup Flow

`aimux` is project-first.

On startup, the app loads the project catalog for the active profile and
enters the project picker flow. Existing projects appear there immediately,
and the same flow also handles first-run project creation.

The default navigation shortcut for the picker is:

- `Ctrl+G`

## Project Picker

The project picker lets you:

- open a project
- create a new project
- rename the selected project
- delete the selected project
- filter the project list

Default keys inside the project picker:

- `j` / `k` - move selection
- `Enter` - open selected project
- `n` - create project
- `r` - rename selected project
- `d` - delete selected project
- `/` - start filtering
- `Esc` - close or return, depending on context

## Creating a Project

The create project modal supports both a name and an optional project path.

Important behavior:

- `Tab` switches between the directory field and the name field
- `Enter` confirms the current action
- if a directory is selected, `aimux` can use the directory basename as the
  project name seed

Project-bound projects are useful when you want every new tab in that project to
start in the same repository or project.

## Project Directory Picker

The runtime can search for repositories and workspaces from `$HOME` using `fzf`.

That directory picker is part of the create-project workflow and is what powers
project-bound projects.

## Project Bar

The project bar shows projects as numbered chips.

It supports:

- click to switch
- drag to reorder
- busy indicators for background activity
- top or bottom placement
- visibility toggling

Default leader shortcuts available from both `navigation` and `terminal-input`
mode:

- `Leader+b` - toggle the project bar
- `Leader+1` through `Leader+9` - switch to project index 1 through 9

The shipped leader is `Ctrl+W`, so these are `Ctrl+W b`, `Ctrl+W 1`, and so on
unless you override the leader.

## Persistence Model

Project records live in:

```text
~/.config/aimux/<profile>/aimux-projects.json
```

Each project can store a `projectSnapshot`, which includes:

- active tab
- tabs and their metadata
- per-tab terminal viewport and scroll position intent
- layout tree or layout trees
- split group information
- sidebar visibility and width

## Restore Behavior

When a project is restored:

- tabs are recreated from the persisted snapshot
- running or starting tabs are restored as `disconnected`
- focus mode resets to `navigation`
- each tab restores its saved scroll position as closely as possible
- saved sidebar width and visibility are restored safely
- grouped tabs are restored as contiguous blocks in tab order

When switching away from a live project and coming back later, `aimux` also
tries to restore the previous scroll anchor for each tab instead of
unconditionally following the bottom of the terminal.

This is intentional: a persisted project is not assumed to still have a live
terminal attachment until the backend reattaches it.

## Automatic Tab Names

New Claude, Codex, OpenCode, Grok, and Kimi tabs are renamed in the background
from their opening prompt. The title uses the same provider as the tab, stays
within six words and 48 characters, and follows the prompt's language.

Only prompts that describe work are used. Slash commands, `!` shell escapes,
confirmations (`y`, `1`, `continue`) and answers to startup dialogs such as the
trust-folder prompt are ignored, and ignoring one costs nothing — the tab stays
armed for the next prompt. Once a usable prompt arrives, aimux waits out a short
settle window (`autoRename.settleMs`, 2.5s by default) so a burst of opening
messages produces a single title covering all of them.

For Claude tabs the prompt comes from Claude Code's `UserPromptSubmit` hook, so
what gets titled is exactly what was submitted. Other providers fall back to
reconstructing the prompt from what you typed.

A failed generation is not the end: the tab stays armed and retries on the next
prompt, up to `autoRename.maxAttempts`. After that — or immediately if the
provider CLI is not installed — aimux derives a title from the prompt text
itself, so a tab does not stay on its assistant label.

Aimux never replaces a title supplied with `aimux tab create --title`, a manual
rename, or a historical tab restored from an older snapshot. Configure or
disable the feature through `autoRename` in `aimux.config.ts`. Because the
prompt is submitted as an additional model request, review the privacy and
model settings in the [config reference](../reference/config-reference.md#autorename).

## Legacy Project Migration

If the new project catalog does not exist but `aimux.json` still contains a
legacy `projectSnapshot`, the runtime migrates that snapshot into a synthetic
project named `Last project`.

## Deleting and Reordering

Project deletion and ordering are runtime-managed behaviors. The app
normalizes project `order` values when loading the catalog so ordering stays
stable.

## Restart Behavior

### `aimux restart-daemon`

Restarts only the IPC daemon.

The design goal is to let the app reconnect to the long-lived terminal manager
without killing live tabs.

### `aimux restart-terminal-manager`

Restarts the long-lived terminal manager and kills live projects.

This is the heavy reset path.

## Related Docs

- `../concepts/config-and-state.md`
- `../concepts/profiles.md`
- `../reference/runtime-paths.md`
