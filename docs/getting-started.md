# Getting Started

This guide walks through the supported setup path for a normal `aimux`
installation.

## Prerequisites

- [Bun](https://bun.sh)
- a terminal that can run the `aimux` TUI
- optional: `fzf` if you want to use the project directory picker

## 1. Install `aimux`

```bash
bun install -g @brimveyn/aimux
```

The `aimux` package provides the CLI, TUI, daemon, terminal manager, and all
runtime persistence.

## 2. Create a Profile

`aimux` stores configuration and runtime state under a profile directory.

The default profile is `default`:

```bash
mkdir -p ~/.config/aimux/default
cd ~/.config/aimux/default
```

If you need multiple isolated environments, set `AIMUX_PROFILE` before
launching `aimux`:

```bash
export AIMUX_PROFILE=work
mkdir -p ~/.config/aimux/work
cd ~/.config/aimux/work
```

See `concepts/profiles.md` for the full profile model.

## 3. Install `@brimveyn/aimux-config` in That Profile

```bash
bun init -y
bun add -d @brimveyn/aimux-config
```

`@brimveyn/aimux-config` is only the typed authoring package. It does not run
the app by itself.

## 4. Create `aimux.config.ts`

Create `~/.config/aimux/<profile>/aimux.config.ts`:

```ts
import { defineConfig, actions } from '@brimveyn/aimux-config'

export default defineConfig({
  sessionBar: {
    initialPosition: 'top',
    initialVisible: true,
  },

  keymaps: (k) =>
    k.mode('navigation', (m) => m.map('<C-p>', actions.sessionPicker, 'Session picker')),
})
```

This example stays inside the surfaces that are wired into the runtime today.

Fields like `sessionBar.initialVisible` are startup overrides. They are applied
again on every launch, while app-managed runtime changes persist in
`aimux.json`.

For a complete reference, see `reference/config-reference.md`.

## 5. Start `aimux`

```bash
aimux
```

On first launch, `aimux` loads:

- `aimux.config.ts` or `aimux.config.js` from the active profile directory
- `aimux.json` if it already exists
- the session catalog and snippet catalog for the active profile

The app starts in the session picker flow. Existing sessions are loaded into the
picker, and if none exist yet you can create the first one there.

## 6. Create Your First Session

The session picker is the main entrypoint for workspace management.

Typical first-run flow:

1. Open `aimux`
2. Create a session from the picker
3. Optionally attach a project directory
4. Open a tab for `claude`, `codex`, `opencode`, or `terminal`
5. Use `i` to focus the terminal and `Ctrl+Z` to return to navigation mode

See `guide/sessions.md` for the full session model.

## 7. Learn the Default Keys

Important defaults:

- `?` opens the help modal
- `i` enters terminal-input mode
- `Ctrl+G` opens the session picker
- `Ctrl+N` opens the new-tab modal
- `Ctrl+S` opens the snippet picker
- `Ctrl+T` opens the theme picker
- `Ctrl+D` enters git mode — see [`guide/git-mode.md`](guide/git-mode.md)
- the shipped leader key is `Ctrl+W`

See `guide/keymaps.md` for the full notation and merge rules.

## Files Created by the App

After you start using `aimux`, the profile directory may contain:

- `aimux.config.ts` - your typed config
- `aimux.json` - app-managed runtime preferences
- `aimux-sessions.json` - session catalog and per-session snapshots
- `aimux-snippets.json` - snippet catalog

See `concepts/config-and-state.md` for the exact ownership of each file.
