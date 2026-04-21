---
title: CLI Reference
description: Every aimux command and its behavior.
---

# CLI Reference

The `aimux` CLI is implemented in `src/index.tsx`.

## Commands

### `aimux`

Starts the TUI.

At startup the CLI:

- resolves the active runtime profile
- creates or connects to the internal session backend that powers workspace state
- loads user config from the active profile
- renders the app

### `aimux version`

Prints the package version and exits.

Aliases:

- `aimux --version`
- `aimux -v`

### `aimux doctor`

Runs setup diagnostics and exits with a status code.

Use this when you need help validating the local installation or persisted
config.

### `aimux update`

Runs the self-update flow.

The app documentation and runtime are designed around a daemon plus
terminal-manager split so that updating or restarting the app-facing daemon does
not necessarily kill live PTYs.

### `aimux restart-daemon`

Restarts the IPC daemon only.

This is the safer restart path when you want to refresh the app-facing runtime
without killing the terminal manager.

### `aimux restart-terminal-manager`

Restarts the long-lived terminal manager.

This kills live workspaces and should be treated as the destructive restart path.

## Hidden Internal Commands

These are used by the runtime itself and are not the normal user entrypoints:

- `aimux daemon`
- `aimux terminal-manager`

## Help Output

The built-in help text currently documents:

- `aimux`
- `aimux update`
- `aimux doctor`
- `aimux restart-daemon`
- `aimux restart-terminal-manager`

Help aliases:

- `aimux --help`
- `aimux -h`

## Profile Awareness

Runtime-oriented commands use the active profile namespace. That affects:

- config file resolution for the TUI startup path
- workspace and snippet catalogs
- daemon socket path
- terminal-manager socket path

Examples that are profile-aware in practice:

- `aimux`
- `aimux doctor`
- `aimux update`
- `aimux restart-daemon`
- `aimux restart-terminal-manager`

Commands such as `aimux version` and `aimux --help` exit early and do not need
to load profile-scoped runtime state.

See `runtime-paths.md` for the exact path rules.
