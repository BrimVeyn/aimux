# aimux

A terminal multiplexer for AI CLIs. Run Claude, Codex, OpenCode, and normal
shell tabs side by side in one TUI with persistent sessions, split panes,
snippets, themes, and fully configurable keymaps.

![Built with Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1)
![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6)
![MIT License](https://img.shields.io/badge/license-MIT-blue)

![aimux demo](assets/demo.gif)

## Features

- multi-session workflow with a dedicated session picker
- tabs for `claude`, `codex`, `opencode`, and `terminal`
- split panes with pane focus and resize shortcuts
- persistent sessions with saved layout and tab state
- profile-isolated config, catalogs, daemon sockets, and runtime state
- typed keymap customization through `@brimveyn/aimux-config`
- snippets catalog and snippet picker
- configurable git pane (embedded in the sidebar or as a standalone pane) and git mode
- built-in help generated from the resolved keymap
- theme picker with 67 built-in themes (shiki catalog + aimux house themes) and a `/` filter
- shiki-powered syntax highlighting in the git diff view

## Install

```bash
bun install -g @brimveyn/aimux
```

Requires [Bun](https://bun.sh).

## Quick Start

Create the default profile and install the typed config package into it:

```bash
mkdir -p ~/.config/aimux/default
cd ~/.config/aimux/default
bun init -y
bun add -d @brimveyn/aimux-config
```

Create `~/.config/aimux/default/aimux.config.ts`:

```ts
import { defineConfig, actions } from '@brimveyn/aimux-config'

export default defineConfig({
  sessionBar: {
    position: 'top',
    visible: true,
  },

  keymaps: (k) =>
    k.mode('navigation', (m) => m.map('<C-p>', actions.sessionPicker, 'Session picker')),
})
```

Then start the app:

```bash
aimux
```

On first launch, use the session picker flow to create your first session.

For the full setup path, see [`docs/getting-started.md`](docs/getting-started.md).

## Core Concepts

### Profiles

Profile-managed config and catalogs live under:

```text
~/.config/aimux/<profile>/
```

The active profile is chosen from:

1. `AIMUX_PROFILE`
2. `AIMUX_RUNTIME_PROFILE`
3. `default`

Runtime sockets live in a separate runtime directory that depends on the active
profile. See [`docs/concepts/profiles.md`](docs/concepts/profiles.md).

### Config vs Runtime State

`aimux` uses multiple files per profile:

- `aimux.config.ts` or `aimux.config.js` - typed user config
- `aimux.json` - app-managed preferences and runtime state
- `aimux-sessions.json` - session catalog and workspace snapshots
- `aimux-snippets.json` - snippet catalog

See [`docs/concepts/config-and-state.md`](docs/concepts/config-and-state.md).

### Sessions

Sessions are named workspaces. A session can have:

- a name
- an optional project directory
- a persisted workspace snapshot
- an order in the session bar and session picker

See [`docs/guide/sessions.md`](docs/guide/sessions.md).

### Keymaps

Keymaps are defined through `@brimveyn/aimux-config` and merged with shipped
defaults at startup.

Important runtime fact:

- the shipped leader key is `Ctrl+W`

See [`docs/guide/keymaps.md`](docs/guide/keymaps.md).

## Default Everyday Shortcuts

- `?` - open help
- `i` - focus terminal
- `Ctrl+Z` - leave terminal-input mode
- `Ctrl+N` - open new-tab modal
- `Ctrl+G` - open session picker
- `Ctrl+S` - open snippet picker
- `Ctrl+T` - open theme picker
- `Ctrl+B` - toggle sidebar
- `Ctrl+W b` - toggle session bar
- `Ctrl+W 1` through `Ctrl+W 9` - switch sessions by index

The help modal reflects the resolved keymap, so it includes your overrides.

## CLI

```bash
aimux
aimux version
aimux doctor
aimux update
aimux restart-daemon
aimux restart-terminal-manager
```

See [`docs/reference/cli.md`](docs/reference/cli.md) for behavior details.

## Runtime Model

`aimux` is split into:

- the UI app
- an IPC daemon
- a long-lived terminal manager

This split is what allows daemon restarts and some update paths without dropping
every live PTY immediately.

See [`docs/developer/architecture.md`](docs/developer/architecture.md).

## Documentation Map

- [`docs/getting-started.md`](docs/getting-started.md)
- [`docs/concepts/config-and-state.md`](docs/concepts/config-and-state.md)
- [`docs/concepts/profiles.md`](docs/concepts/profiles.md)
- [`docs/guide/sessions.md`](docs/guide/sessions.md)
- [`docs/guide/keymaps.md`](docs/guide/keymaps.md)
- [`docs/guide/themes.md`](docs/guide/themes.md)
- [`docs/reference/cli.md`](docs/reference/cli.md)
- [`docs/reference/config-reference.md`](docs/reference/config-reference.md)
- [`docs/reference/runtime-paths.md`](docs/reference/runtime-paths.md)
- [`docs/developer/architecture.md`](docs/developer/architecture.md)
- [`docs/developer/aimux-config-internals.md`](docs/developer/aimux-config-internals.md)

## Development

```bash
git clone https://github.com/BrimVeyn/aimux && cd aimux
bun install

bun run dev
bun run start
bun test
bun run check
bun run lint
```

The repository dev scripts use `AIMUX_PROFILE=dev`, so local development does
not collide with a globally installed `aimux` instance.

## License

MIT © BrimVeyn
