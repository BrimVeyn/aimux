---
title: Config and State
description: Canonical split between aimux.config.ts, aimux.json, aimux-sessions.json, and aimux-snippets.json.
---

# Config and State

`aimux` uses more than one file under the active profile. They do not all serve
the same purpose.

This page is the canonical explanation of that split.

## Profile Root

All paths below are relative to the active profile directory:

```text
~/.config/aimux/<profile>/
```

See `profiles.md` for how `<profile>` is chosen.

## The Four Important Files

| File                                   | Written by | Purpose                                             |
| -------------------------------------- | ---------- | --------------------------------------------------- |
| `aimux.config.ts` or `aimux.config.js` | You        | Typed user configuration loaded at startup          |
| `aimux.json`                           | The app    | Runtime preferences and app-managed state           |
| `aimux-sessions.json`                  | The app    | Workspace catalog and persisted workspace snapshots |
| `aimux-snippets.json`                  | The app    | Snippet catalog                                     |

## `aimux.config.ts` and `aimux.config.js`

This is the authoring surface provided by `@brimveyn/aimux-config`.

The runtime loader checks these filenames in order:

1. `aimux.config.ts`
2. `aimux.config.js`

If neither file exists, `aimux` falls back to the package defaults.

This file is meant for:

- keymap customization
- startup overrides such as `sessionBar.initialVisible` or `gitPane.initialMode`
- other exported config fields from `@brimveyn/aimux-config`

Important: not every typed field exported by `@brimveyn/aimux-config` is fully
consumed by the app runtime yet. See `../reference/config-reference.md` for the
support status of each field.

## `aimux.json`

`aimux.json` is app-managed state, not your typed config.

Today it is used for values such as:

- `customCommands`
- `themeId`
- `gitPane` (`{ visible, mode, position, ratio, diffModeRatio, fileListMode }`)
- `sessionBarVisible`
- `workspaceSnapshot` for legacy migration
- `skippedUpdateVersion`

Legacy top-level keys `gitPanelVisible` / `gitPanelRatio` are still read on
load for backward compatibility and migrated into `gitPane` on the next save.

This file is created and updated by the app.

You should think of it as persisted UI/runtime state, not as the primary place
to author behavior.

If a typed config field is wired into startup, it acts as a startup override:
the value is re-applied on every launch, and runtime UI interactions do not
write back into `aimux.config.ts`.

## `aimux-sessions.json`

This file stores the workspace catalog.

Each workspace record can contain:

- `id`
- `name`
- `projectPath`
- timestamps
- `order`
- a `workspaceSnapshot`

The workspace snapshot stores tab and layout state for that workspace.

That is why workspace persistence belongs to `aimux-sessions.json`, not to your
typed config file.

## `aimux-snippets.json`

This file stores the user-edited snippet catalog used by the snippet picker.

If it does not exist, `aimux` seeds it with built-in default snippets such as:

- code review
- explain
- write tests
- refactor
- fix error

Snippets declared in `aimux.config.ts` are not stored here. They are merged
into the runtime catalog at every launch with id prefix `config:` and are
read-only in the picker. See `../guide/snippets.md`.

Shell-execution `vars` are stripped from any entry in this file at load time —
only the typed config may declare them. This is a defensive boundary so a
tool that writes into `aimux-snippets.json` cannot inject shell commands.

## Runtime Precedence and Interaction

### Workspace Bar (`sessionBar`)

`sessionBar` is one of the few top-level typed config fields that is wired into
runtime initialization today.

At startup, the app resolves workspace bar state like this:

1. `resolvedConfig.sessionBar.initial*`
2. `aimux.json`
3. runtime defaults

That means your typed config can pin startup behavior while the runtime still
persists the current UI state separately.

### Git Pane

`gitPane` follows the same precedence pattern as `sessionBar`:

1. `resolvedConfig.gitPane.initial*` (typed config)
2. `aimux.json.gitPane` (persisted state)
3. built-in defaults (`{ mode: 'embedded', position: 'bottom', ratio: 0.5, diffModeRatio: 0.35, fileListMode: 'tree', ... }`)

Fields you do not set in typed config fall through to the persisted or default
values. Fields you do set are reapplied on every launch, so runtime toggles,
mode changes, and resizes for those fields will not stick while the config
entry remains present.

### Theme

The typed config exposes `theme.initialMode` and `theme.paletteOverrides`.

The picker persists the confirmed `themeId` to `aimux.json`. On next launch the
persisted id wins if it still resolves to a known theme, otherwise the typed
`theme.initialMode` field is used to choose the built-in light or dark family.

### Workspaces

Workspaces are not authored in `aimux.config.ts`.

They are created, renamed, deleted, reordered, and persisted by the runtime in
`aimux-sessions.json`.

### Snippets

Snippets have two sources, merged at startup:

1. `aimux.config.ts` — the typed `snippets[]` array. Each entry becomes a
   read-only picker row with id `config:${name}`. Required source for any
   snippet that uses shell-backed `vars`.
2. `aimux-snippets.json` — the user-edited catalog. Created from the picker
   (`Ctrl+S`) and persisted as you add / edit / delete entries.

Config-pinned entries win on id collision and cannot be modified from the
picker. See `../guide/snippets.md` for the full lifecycle, including inline
trigger expansion and shell variables.

## Legacy Migration

If `aimux-sessions.json` does not exist but `aimux.json` still contains a legacy
`workspaceSnapshot`, `aimux` migrates that snapshot into a new workspace called
`Last workspace`, writes it to the session catalog, and clears the legacy field
from `aimux.json`.

This is one of the reasons the config and state files are documented separately.

## Recommendation

Use each file for what it is meant to control:

- use `aimux.config.ts` for explicit startup intent and structural config
- let `aimux.json` store app-managed preferences
- let `aimux-sessions.json` own workspace persistence
- let `aimux-snippets.json` own snippet persistence
