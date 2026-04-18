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

| File                                   | Written by | Purpose                                           |
| -------------------------------------- | ---------- | ------------------------------------------------- |
| `aimux.config.ts` or `aimux.config.js` | You        | Typed user configuration loaded at startup        |
| `aimux.json`                           | The app    | Runtime preferences and app-managed state         |
| `aimux-sessions.json`                  | The app    | Session catalog and persisted workspace snapshots |
| `aimux-snippets.json`                  | The app    | Snippet catalog                                   |

## `aimux.config.ts` and `aimux.config.js`

This is the authoring surface provided by `@brimveyn/aimux-config`.

The runtime loader checks these filenames in order:

1. `aimux.config.ts`
2. `aimux.config.js`

If neither file exists, `aimux` falls back to the package defaults.

This file is meant for:

- keymap customization
- `sessionBar` defaults
- other exported config fields from `@brimveyn/aimux-config`

Important: not every typed field exported by `@brimveyn/aimux-config` is fully
consumed by the app runtime yet. See `../reference/config-reference.md` for the
support status of each field.

## `aimux.json`

`aimux.json` is app-managed state, not your typed config.

Today it is used for values such as:

- `customCommands`
- `themeId`
- `gitPane` (`{ visible, mode, position, ratio }`)
- `sessionBarVisible`
- `sessionBarPosition`
- `workspaceSnapshot` for legacy migration
- `skippedUpdateVersion`

Legacy top-level keys `gitPanelVisible` / `gitPanelRatio` are still read on
load for backward compatibility and migrated into `gitPane` on the next save.

This file is created and updated by the app.

You should think of it as persisted UI/runtime state, not as the primary place
to author behavior.

## `aimux-sessions.json`

This file stores the session catalog.

Each session record can contain:

- `id`
- `name`
- `projectPath`
- timestamps
- `order`
- a `workspaceSnapshot`

The workspace snapshot stores tab and layout state for that session.

That is why session persistence belongs to `aimux-sessions.json`, not to your
typed config file.

## `aimux-snippets.json`

This file stores the snippet catalog used by the snippet picker.

If it does not exist, `aimux` seeds it with built-in default snippets such as:

- code review
- explain
- write tests
- refactor
- fix error

## Runtime Precedence and Interaction

### Session Bar

`sessionBar` is one of the few top-level typed config fields that is wired into
runtime initialization today.

At startup, the app resolves session bar state like this:

1. `resolvedConfig.sessionBar`
2. `aimux.json`
3. runtime defaults

That means your typed config can override app-managed session bar preferences.

### Git Pane

`gitPane` follows the same precedence pattern as `sessionBar`:

1. `resolvedConfig.gitPane` (typed config)
2. `aimux.json.gitPane` (persisted state)
3. built-in defaults (`{ mode: 'embedded', position: 'bottom', ratio: 0.5, ... }`)

Fields you do not set in your typed config fall through to the persisted or
default values, so users can still toggle and resize at runtime without losing
their programmatic preferences.

### Theme

The theme situation is different.

The typed config package exposes `theme`, `themes.extend()`, and
`themes.create()`, but the app currently initializes theme state from
`aimux.json.themeId`, and the theme picker persists a built-in `themeId` back to
`aimux.json`.

Treat typed theme definitions as `Partially supported` until the runtime fully
consumes them.

### Sessions

Sessions are not authored in `aimux.config.ts`.

They are created, renamed, deleted, reordered, and persisted by the runtime in
`aimux-sessions.json`.

### Snippets

Snippets are currently runtime-managed through `aimux-snippets.json`.

Even though `@brimveyn/aimux-config` exposes a typed `snippets` field, the app
runtime currently loads snippets from the catalog file.

## Legacy Migration

If `aimux-sessions.json` does not exist but `aimux.json` still contains a legacy
`workspaceSnapshot`, `aimux` migrates that snapshot into a new session called
`Last workspace`, writes it to the session catalog, and clears the legacy field
from `aimux.json`.

This is one of the reasons the config and state files are documented separately.

## Recommendation

Use each file for what it is meant to control:

- use `aimux.config.ts` for explicit, versioned user intent
- let `aimux.json` store app-managed preferences
- let `aimux-sessions.json` own session persistence
- let `aimux-snippets.json` own snippet persistence
