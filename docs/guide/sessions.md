# Sessions

Sessions are the top-level workspace concept in `aimux`.

Each session can have:

- a name
- an optional `projectPath`
- an order in the session list
- a persisted workspace snapshot

That snapshot contains the session's tabs, layout, some sidebar state, and the
last known terminal viewport / scroll anchor for each tab.

## Startup Flow

`aimux` is session-first.

On startup, the app loads the session catalog for the active profile and enters
the session picker flow. Existing sessions appear there immediately, and the
same flow also handles first-run session creation.

The default navigation shortcut for the picker is:

- `Ctrl+G`

## Session Picker

The session picker lets you:

- open a session
- create a new session
- rename the selected session
- delete the selected session
- filter the session list

Default keys inside the session picker:

- `j` / `k` - move selection
- `Enter` - open selected session
- `n` - create session
- `r` - rename selected session
- `d` - delete selected session
- `/` - start filtering
- `Esc` - close or return, depending on context

## Creating a Session

The create-session modal supports both a name and an optional project path.

Important behavior:

- `Tab` switches between the directory field and the name field
- `Enter` confirms the current action
- if a directory is selected, `aimux` can use the directory basename as the
  session name seed

Project-bound sessions are useful when you want every new tab in that session to
start in the same repository or workspace.

## Project Directory Picker

The runtime can search for repositories and worktrees from `$HOME` using `fzf`.

That directory picker is part of the create-session workflow and is what powers
project-bound sessions.

## Session Bar

The session bar shows sessions as numbered chips.

It supports:

- click to switch
- drag to reorder
- busy indicators for background activity
- top or bottom placement
- visibility toggling

Default leader shortcuts available from both `navigation` and `terminal-input`
mode:

- `Leader+b` - toggle the session bar
- `Leader+1` through `Leader+9` - switch to session index 1 through 9

The shipped leader is `Ctrl+W`, so these are `Ctrl+W b`, `Ctrl+W 1`, and so on
unless you override the leader.

## Persistence Model

Session records live in:

```text
~/.config/aimux/<profile>/aimux-sessions.json
```

Each session can store a `workspaceSnapshot`, which includes:

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

When switching away from a live session and coming back later, `aimux` also
tries to restore the previous scroll anchor for each tab instead of
unconditionally following the bottom of the terminal.

This is intentional: a persisted workspace is not assumed to still have a live
terminal attachment until the backend reattaches it.

## Legacy Workspace Migration

If the new session catalog does not exist but `aimux.json` still contains a
legacy `workspaceSnapshot`, the runtime migrates that snapshot into a synthetic
session named `Last workspace`.

## Deleting and Reordering

Session deletion and ordering are runtime-managed behaviors. The app normalizes
session `order` values when loading the catalog so ordering stays stable.

## Restart Behavior

### `aimux restart-daemon`

Restarts only the IPC daemon.

The design goal is to let the app reconnect to the long-lived terminal manager
without killing live tabs.

### `aimux restart-terminal-manager`

Restarts the long-lived terminal manager and kills live sessions.

This is the heavy reset path.

## Related Docs

- `../concepts/config-and-state.md`
- `../concepts/profiles.md`
- `../reference/runtime-paths.md`
