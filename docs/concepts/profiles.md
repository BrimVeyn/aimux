---
title: Profiles
description: Profile selection, env vars, directory layout, and runtime isolation.
---

# Profiles

Profiles isolate `aimux` environments on the same machine.

Each profile has its own:

- typed config
- app-managed config
- workspace catalog
- snippet catalog
- daemon socket
- terminal-manager socket

## Selecting the Active Profile

`aimux` resolves the active profile from environment variables in this order:

1. `AIMUX_PROFILE`
2. `AIMUX_RUNTIME_PROFILE`
3. `default`

Examples:

```bash
aimux
```

Uses the `default` profile unless one of the environment variables is set.

```bash
AIMUX_PROFILE=work aimux
```

Uses the `work` profile.

## Profile Name Sanitization

Profile names are normalized before use.

The runtime:

- trims whitespace
- lowercases the name
- replaces non `[a-z0-9._-]` characters with `-`
- collapses repeated `-`
- falls back to `default` if the result is empty

Example:

- `Dev Sandbox` becomes `dev-sandbox`

## Config Directory Layout

The config profiles root is:

```text
~/.config/aimux/
```

The active profile directory is:

```text
~/.config/aimux/<profile>/
```

Typical contents:

```text
~/.config/aimux/default/
|- aimux.config.ts
|- aimux.json
|- aimux-sessions.json
`- aimux-snippets.json
```

## Runtime Directory Layout

The daemon and terminal manager do not use the config directory for their socket
files.

Runtime base directory:

- if `XDG_RUNTIME_DIR` is set: `XDG_RUNTIME_DIR/aimux-<profile>`
- otherwise: `~/.local/state/aimux-<profile>`

Socket files inside that directory:

- `daemon.sock`
- `terminal-manager.sock`

See `../reference/runtime-paths.md` for the exact paths.

## Why Profiles Matter

Profiles are the safest way to keep environments isolated.

Common uses:

- a normal `default` profile for daily use
- a `dev` profile for source builds
- a `work` profile for a separate workspace catalog and snippet set
- a temporary profile for testing a risky config change

## Repository Development Profile

The repository development scripts set `AIMUX_PROFILE=dev`.

That means local source builds use:

- `~/.config/aimux/dev/`
- a `dev`-namespaced daemon socket
- a `dev`-namespaced terminal-manager socket

This prevents local development from stomping on a globally installed `aimux`
instance.

## Compatibility Note

Once profile directories are enabled, `aimux` no longer reads legacy flat config
or catalog files directly from `~/.config/aimux/`.
