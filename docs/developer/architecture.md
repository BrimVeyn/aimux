# Architecture

This page is for developers who need the runtime model behind `aimux`, not just
the user-facing workflows.

## High-level Split

`aimux` is intentionally split into three major runtime roles:

- the app UI
- the IPC daemon
- the terminal manager

## App UI

The TUI process:

- renders the interface
- loads resolved config
- registers keymap handlers
- manages the app state tree
- talks to the backend through the app protocol

Important files:

- `src/index.tsx`
- `src/app.tsx`
- `src/ui/`
- `src/input/`

## IPC Daemon

The daemon owns:

- the app-facing socket
- protocol negotiation
- reconnect behavior between app processes and the long-lived runtime

Important files:

- `src/daemon/`
- `src/session-backend/bootstrap.ts`

## Terminal Manager

The terminal manager owns:

- PTYs
- headless terminal emulators
- live session state

This is why a daemon restart does not need to kill live tabs.

Important files:

- `src/terminal-manager/`
- `src/pty/`

## Config Flow

1. `src/index.tsx` resolves the active runtime profile
2. `src/config/loader.ts` loads `aimux.config.ts` or `aimux.config.js`
3. `@brimveyn/aimux-config` resolves user config against defaults
4. `src/app.tsx` consumes the resolved config and app-managed JSON state

Important nuance:

- `resolvedConfig.keymaps` is registered by the runtime
- `resolvedConfig.sessionBar` is consumed at startup
- several other resolved top-level fields are currently exported but not fully
  consumed by the runtime

## Persistence Flow

### App-managed config

- `src/config.ts`
- file: `aimux.json`

Stores UI/runtime preferences such as theme ID, session bar state, git panel
state, custom commands, and legacy workspace data.

### Session catalog

- `src/state/session-catalog.ts`
- `src/state/session-persistence.ts`
- file: `aimux-sessions.json`

Stores named sessions and per-session workspace snapshots.

### Snippet catalog

- `src/state/snippet-catalog.ts`
- file: `aimux-snippets.json`

Stores the snippet list used by the snippet picker.

## Keymap Runtime Model

`@brimveyn/aimux-config` defines the typed builder and shipped defaults.

At runtime:

1. the config package returns a `ResolvedKeymapConfig`
2. `src/app.tsx` passes that config into the mode registration pipeline
3. help UI and displayed bindings are generated from the resolved keymap

Important files:

- `packages/aimux-config/src/defaults.ts`
- `packages/aimux-config/src/keymap-builder.ts`
- `packages/aimux-config/src/resolver.ts`
- `src/input/keymap/describe-bindings.ts`
- `src/input/keymap/key-chord.ts`

## Theme Runtime Model

Theme state lives in three places:

- `aimux.json.themeId` — the theme last confirmed in the picker, persisted per
  profile.
- `AimuxUserConfig.theme` / `.themes` — declarative initial theme and
  user-defined themes from `aimux.config.ts`.
- The in-memory `THEMES` registry — the shipped shiki + house themes merged
  with user themes at startup via `registerUserThemes()`.

On boot the runtime picks the active id as: persisted `themeId` (if known)
→ `resolvedConfig.theme` → `aimux`. Shiki themes load on demand via
`ensureShikiTheme()`; user-defined themes are registered with shiki by
synthesizing a TextMate theme from their palette.

## Profiles and Isolation

Profiles isolate both config files and runtime sockets.

Important files:

- `src/profile-paths.ts`
- `src/daemon/runtime-paths.ts`

This is the mechanism that allows repository dev mode to use a `dev` profile
without colliding with a global installation.
