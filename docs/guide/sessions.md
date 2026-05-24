---
title: Workspaces
description: Workspace picker, project-bound workspaces, persistence, reorder, and reconnect behavior.
---

# Workspaces

Workspaces are the top-level user-facing concept in `aimux`.

For compatibility, the runtime and persisted data still use `session` naming in
places such as `aimux-sessions.json`, `sessionId`, and related config or API
symbols.

Each workspace can have:

- a name
- an optional `projectPath`
- an order in the workspace list
- a persisted workspace snapshot
- a set of git [worktrees](worktrees.md) for running agents on parallel branches

That snapshot contains the workspace's tabs, layout, some sidebar state, and the
last known terminal viewport / scroll anchor for each tab.

## Startup Flow

`aimux` is workspace-first.

On startup, the app loads the workspace catalog for the active profile and
enters the workspace picker flow. Existing workspaces appear there immediately,
and the same flow also handles first-run workspace creation.

The default navigation shortcut for the picker is:

- `Ctrl+G`

## Workspace Picker

The workspace picker lets you:

- open a workspace
- create a new workspace
- rename the selected workspace
- delete the selected workspace
- filter the workspace list

Default keys inside the workspace picker:

- `j` / `k` - move selection
- `Enter` - open selected workspace
- `n` - create workspace
- `r` - rename selected workspace
- `d` - delete selected workspace
- `/` - start filtering
- `Esc` - close or return, depending on context

## Creating a Workspace

The create workspace modal supports both a name and an optional project path.

Important behavior:

- `Tab` switches between the directory field and the name field
- `Enter` confirms the current action
- if a directory is selected, `aimux` can use the directory basename as the
  workspace name seed

Project-bound workspaces are useful when you want every new tab in that workspace to
start in the same repository or workspace.

## Project Directory Picker

The runtime can search for repositories and worktrees from `$HOME` using `fzf`.

That directory picker is part of the create-workspace workflow and is what powers
project-bound workspaces.

## Workspace Bar

The workspace bar shows workspaces as numbered chips.

It supports:

- click to switch
- drag to reorder
- busy indicators for background activity
- top or bottom placement
- visibility toggling

Default leader shortcuts available from both `navigation` and `terminal-input`
mode:

- `Leader+b` - toggle the workspace bar
- `Leader+1` through `Leader+9` - switch to workspace index 1 through 9

The shipped leader is `Ctrl+W`, so these are `Ctrl+W b`, `Ctrl+W 1`, and so on
unless you override the leader.

## Persistence Model

Workspace records live in:

```text
~/.config/aimux/<profile>/aimux-sessions.json
```

Each workspace can store a `workspaceSnapshot`, which includes:

- active tab
- tabs and their metadata
- per-tab terminal viewport and scroll position intent
- layout tree or layout trees
- split group information
- sidebar visibility and width

## Restore Behavior

When a workspace is restored:

- tabs are recreated from the persisted snapshot
- running or starting tabs are restored as `disconnected`
- focus mode resets to `navigation`
- each tab restores its saved scroll position as closely as possible
- saved sidebar width and visibility are restored safely
- grouped tabs are restored as contiguous blocks in tab order

When switching away from a live workspace and coming back later, `aimux` also
tries to restore the previous scroll anchor for each tab instead of
unconditionally following the bottom of the terminal.

This is intentional: a persisted workspace is not assumed to still have a live
terminal attachment until the backend reattaches it.

## Legacy Workspace Migration

If the new workspace catalog does not exist but `aimux.json` still contains a
legacy `workspaceSnapshot`, the runtime migrates that snapshot into a synthetic
workspace named `Last workspace`.

## Deleting and Reordering

Workspace deletion and ordering are runtime-managed behaviors. The app
normalizes workspace `order` values when loading the catalog so ordering stays
stable.

## Restart Behavior

### `aimux restart-daemon`

Restarts only the IPC daemon.

The design goal is to let the app reconnect to the long-lived terminal manager
without killing live tabs.

### `aimux restart-terminal-manager`

Restarts the long-lived terminal manager and kills live workspaces.

This is the heavy reset path.

## Related Docs

- `../concepts/config-and-state.md`
- `../concepts/profiles.md`
- `../reference/runtime-paths.md`
