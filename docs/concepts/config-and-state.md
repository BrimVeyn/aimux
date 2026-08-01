---
title: Config and State
description: Canonical split between aimux.config.ts, aimux.json, aimux-projects.json, and aimux-snippets.json.
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

| File                                   | Written by | Purpose                                         |
| -------------------------------------- | ---------- | ----------------------------------------------- |
| `aimux.config.ts` or `aimux.config.js` | You        | Typed user configuration loaded at startup      |
| `aimux.json`                           | The app    | Runtime preferences and app-managed state       |
| `aimux-projects.json`                  | The app    | Project catalog and persisted project snapshots |
| `aimux-snippets.json`                  | The app    | Snippet catalog                                 |

## `aimux.config.ts` and `aimux.config.js`

This is the authoring surface provided by `@brimveyn/aimux-config`.

The runtime loader checks these filenames in order:

1. `aimux.config.ts`
2. `aimux.config.js`

If neither file exists, `aimux` falls back to the package defaults.

This file is meant for:

- keymap customization
- startup overrides such as `projectBar.initialVisible` or `gitPane.initialFileListMode`
- other exported config fields from `@brimveyn/aimux-config`

Important: not every typed field exported by `@brimveyn/aimux-config` is fully
consumed by the app runtime yet. See `../reference/config-reference.md` for the
support status of each field.

## `aimux.json`

`aimux.json` is app-managed state, not your typed config.

Today it is used for values such as:

- `customCommands`
- `themeId`
- `bars` (`{ left, right }`, each `{ visible, width, widgets }`) — the left/right
  widget bars
- `gitPane` (`{ diffModeRatio, fileListMode, treeCompaction }`) — git content prefs
- `projectBarVisible`
- `projectSnapshot` for legacy migration
- `skippedUpdateVersion`
- `settings` — what the in-app settings screen has written, keyed by row id. Only
  the rows the user actually touched appear; a key this build does not recognise
  is preserved on write, so a downgrade does not erase what a newer one wrote.
  See `guide/settings.md`.

Legacy top-level keys `gitPanelVisible` / `gitPanelRatio` are still read on
load for backward compatibility. A file with no `bars` key is upgraded from the
old `sidebar` + `gitPane.mode`/`position` placement fields on load, and `bars`
is written on the next save.

This file is created and updated by the app.

You should think of it as persisted UI/runtime state, not as the primary place
to author behavior.

If a typed config field is wired into startup, it acts as a startup override:
the value is re-applied on every launch, and runtime UI interactions do not
write back into `aimux.config.ts`.

That is also the rule the settings screen follows: it writes to `aimux.json`, its
change applies immediately, and a field your `aimux.config.ts` declares comes back
from that file on the next launch. The row says so while you are on it. The one
exception is `themeId`, which is a choice made interactively many times a session
and so outranks `theme.initialId`.

## `aimux-projects.json`

This file stores the project catalog.

Each project record can contain:

- `id`
- `name`
- `projectPath`
- timestamps
- `order`
- a `projectSnapshot`

The project snapshot stores tab and layout state for that project.

That is why project persistence belongs to `aimux-projects.json`, not to your
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

### Project Bar (`projectBar`)

`projectBar` is one of the few top-level typed config fields that is wired into
runtime initialization today.

At startup, the app resolves project bar state like this:

1. `resolvedConfig.projectBar.initial*`
2. `aimux.json`
3. runtime defaults

That means your typed config can pin startup behavior while the runtime still
persists the current UI state separately.

### Git Pane

`gitPane` follows the same precedence pattern as `projectBar`:

1. `resolvedConfig.gitPane.initial*` (typed config)
2. `aimux.json.gitPane` (persisted state)
3. built-in defaults (`{ diffModeRatio: 0.35, fileListMode: 'tree', treeCompaction: true, ... }`)

Fields you do not set in typed config fall through to the persisted or default
values. Fields you do set are reapplied on every launch, so runtime toggles for
those fields will not stick while the config entry remains present.

Where the git pane _sits_ is no longer part of this: placement lives in `bars`
and is always app-managed.

### Theme

The typed config exposes `theme.initialMode` and `theme.paletteOverrides`.

The picker persists the confirmed `themeId` to `aimux.json`. On next launch the
persisted id wins if it still resolves to a known theme, otherwise the typed
`theme.initialMode` field is used to choose the built-in light or dark family.

### Projects

Projects are not authored in `aimux.config.ts`.

They are created, renamed, deleted, reordered, and persisted by the runtime in
`aimux-projects.json`.

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

### `aimux-sessions.json` -> `aimux-projects.json`

Before the project/workspace rename the catalog lived in `aimux-sessions.json`
(version 1). On first launch after upgrading, `aimux` reads that file, renames
its keys (`worktrees` -> `workspaces`, `activeWorktreeId` ->
`activeWorkspaceId`, `workspaceSnapshot` -> `projectSnapshot`, each tab's
`worktreeId` -> `workspaceId`) and writes `aimux-projects.json` (version 2).

Record ids are left alone, so a migrated project keeps its `session-*` id. The
old file is **not** deleted, so downgrading still works; it will be dropped in
a later release.

### `aimux.json` `projectSnapshot`

If neither catalog exists but `aimux.json` still contains a legacy
`projectSnapshot`, `aimux` migrates that snapshot into a new project called
`Last project`, writes it to the project catalog, and clears the legacy field
from `aimux.json`.

This is one of the reasons the config and state files are documented separately.

## Recommendation

Use each file for what it is meant to control:

- use `aimux.config.ts` for explicit startup intent and structural config
- let `aimux.json` store app-managed preferences
- let `aimux-projects.json` own project persistence
- let `aimux-snippets.json` own snippet persistence
