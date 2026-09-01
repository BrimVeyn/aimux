---
title: Runtime Paths
description: Config paths, catalog paths, runtime directories, and socket files.
---

# Runtime Paths

All paths below depend on the active profile.

## Config Root

Config profiles root:

```text
~/.config/aimux/
```

Active profile directory:

```text
~/.config/aimux/<profile>/
```

`<profile>` is resolved from `AIMUX_PROFILE`, then `AIMUX_RUNTIME_PROFILE`, then
`default`.

## Files Under the Active Profile Directory

| Path                  | Purpose                               |
| --------------------- | ------------------------------------- |
| `aimux.config.ts`     | preferred typed config file           |
| `aimux.config.js`     | fallback typed config file            |
| `aimux.json`          | app-managed runtime preferences       |
| `aimux-projects.json` | project catalog and project snapshots |
| `aimux-snippets.json` | snippet catalog                       |
| `sounds/`             | your own notification sounds          |

Any audio file dropped in `sounds/` (`.wav`, `.m4a`, `.mp3`, `.aiff`, `.ogg`,
`.flac`) is offered alongside the shipped ones under **Settings → Notifications
→ Sound**, listed by its filename without the extension. The directory is read
at launch, so a file added while aimux is running shows up the next time it
starts.

## Per-Project Data

Data that belongs to one project rather than to the whole profile:

```text
~/.config/aimux/<profile>/projects/<projectId>/
```

| Path       | Purpose                                                      |
| ---------- | ------------------------------------------------------------ |
| `setup.sh` | executable setup script, run in each newly created workspace |

Keyed by project id rather than name, so renaming a project keeps its data. See
[../guide/workspaces.md](../guide/workspaces.md) for the setup script itself.

## Config Loader Search Order

The user config loader checks these files in order:

1. `aimux.config.ts`
2. `aimux.config.js`

If neither exists, the runtime uses the defaults from `@brimveyn/aimux-config`.

## Runtime Directory

The daemon and terminal manager use a runtime directory separate from the config
directory.

If `XDG_RUNTIME_DIR` is set:

```text
<XDG_RUNTIME_DIR>/aimux-<profile>/
```

Otherwise:

```text
~/.local/state/aimux-<profile>/
```

## Worktree Root

Workspaces aimux creates itself live under:

```text
<XDG_DATA_HOME or ~/.local/share>/aimux/worktrees/r-<repo-hash>/<slug>
```

Set `AIMUX_WORKTREE_ROOT` to put them somewhere else. The root is deliberately
not under `/tmp`: it holds uncommitted work, and a reboot clears `/tmp`.
Worktrees created by older versions under `/tmp/aimux-wt` are still recognized
as aimux-managed, so aimux can delete them — but nothing new is created there.

## Socket Paths

Inside the runtime directory:

| Path                    | Purpose                            |
| ----------------------- | ---------------------------------- |
| `daemon.sock`           | app-facing daemon socket           |
| `terminal-manager.sock` | long-lived terminal manager socket |

Examples for the default profile when `XDG_RUNTIME_DIR=/run/user/1000`:

```text
/run/user/1000/aimux-default/daemon.sock
/run/user/1000/aimux-default/terminal-manager.sock
```

## Claude Hook URL File

When the daemon starts its [Claude Code hook server](../guide/claude-integration.md),
it writes the live URL to a stable file inside the runtime directory:

| Path              | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `claude-hook.url` | Current HTTP URL of the daemon's Claude hook server (mode 0600) |

The shipped hook bridge reads this file on every invocation, so PTYs that
outlive a daemon restart automatically reach the new daemon's port.

Example for a sanitized profile name `Dev Sandbox`:

```text
<runtime-base>/aimux-dev-sandbox/daemon.sock
<runtime-base>/aimux-dev-sandbox/terminal-manager.sock
```

## Security Notes

The runtime ensures:

- runtime directories exist
- runtime directories are tightened to `0700` on a best-effort basis
- socket permissions are tightened on a best-effort basis

The runtime also checks for obvious socket-security issues such as:

- missing socket
- path is not a socket
- socket owned by a different user
- socket writable by group or others

## Related Docs

- `../concepts/profiles.md`
- `../concepts/config-and-state.md`
- `cli.md`
