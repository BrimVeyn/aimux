# aimux

A terminal multiplexer for AI CLIs. Run Claude, Codex, OpenCode, and normal
shell tabs side by side in one TUI with persistent workspaces, split panes,
snippets, themes, and fully configurable keymaps.

![Built with Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1)
![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6)
![MIT License](https://img.shields.io/badge/license-MIT-blue)

![aimux demo](assets/demo.gif)

## Features

- multi-workspace workflow with a dedicated workspace picker
- tabs for `claude`, `codex`, `opencode`, `grok`, `kimi`, and `terminal`
- split panes with pane focus and resize shortcuts
- persistent workspaces with saved layout and tab state
- profile-isolated config, catalogs, daemon sockets, and runtime state
- typed keymap customization through `@brimveyn/aimux-config`
- snippets catalog and snippet picker
- configurable git pane (embedded in the sidebar or as a standalone pane) and a
  dedicated [git mode](docs/guide/git-mode.md) for review / stage / commit /
  push with a split or stacked diff view and shiki-powered highlighting
- [git worktrees](docs/guide/worktrees.md) for running agents on parallel
  branches — create per-branch worktrees, review each against its base, and
  squash-move a worktree's work into another
- built-in help generated from the resolved keymap
- theme picker with 67 built-in themes (shiki catalog + aimux house themes) and a `/` filter

## Install

```bash
bun install -g @brimveyn/aimux
```

Requires [Bun](https://bun.sh).

Shell completion (bash, zsh, fish) installs itself the first time you launch
the TUI — one file in your shell's completions directory, no dotfile edits.
Run `aimux doctor` to see where it landed, or
`aimux completion install --shell zsh` to place it yourself. Opt out with
`AIMUX_NO_COMPLETION_INSTALL=1`. See [docs/reference/cli.md](docs/reference/cli.md#aimux-completion).

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
    initialPosition: 'top',
    initialVisible: true,
  },

  keymaps: (k) =>
    k.mode('navigation', (m) => m.map('<C-p>', actions.sessionPicker, 'Workspace picker')),
})
```

Typed config is startup intent, not app-managed persisted state. Fields like
`sessionBar.initialVisible` and `sessionBar.initialPosition` are reapplied on
every launch, so runtime UI changes for those fields do not stick while the
config entry remains set.

Then start the app:

```bash
aimux
```

On first launch, use the workspace picker flow to create your first workspace.

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
- `aimux-sessions.json` - workspace catalog and workspace snapshots
- `aimux-snippets.json` - snippet catalog

Rule of thumb:

- `aimux.config.ts` declares startup intent
- `aimux.json` stores app-managed runtime preferences
- runtime actions never rewrite `aimux.config.ts`

See [`docs/concepts/config-and-state.md`](docs/concepts/config-and-state.md).

### Workspaces

Workspaces are the top-level user-facing concept in `aimux`. Internally, the
runtime still uses `session` naming for compatibility. A workspace can have:

- a name
- an optional project directory
- a persisted workspace snapshot
- an order in the workspace bar and workspace picker

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
- `Ctrl+G` - open workspace picker
- `Ctrl+S` - open snippet picker
- `Ctrl+T` - open theme picker
- `Ctrl+B` - toggle sidebar
- `Ctrl+D` - enter git mode
- `Ctrl+W b` - toggle workspace bar
- `Ctrl+W 1` through `Ctrl+W 9` - switch workspaces by index

The help modal reflects the resolved keymap, so it includes your overrides.

## CLI

```bash
aimux
aimux worker doctor
aimux worker run --name investigate --assistant claude "inspect this repository"
aimux version
aimux doctor
aimux update
aimux restart-daemon
aimux restart-terminal-manager
```

See [`docs/reference/cli.md`](docs/reference/cli.md) for behavior details.

For agent orchestration, prefer the named `aimux worker` commands. They combine
isolated worktree creation, prompt dispatch, authoritative turn waiting, fleet
inspection, and guarded cleanup without shell wrappers or `jq`.

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
- [`docs/guide/git-mode.md`](docs/guide/git-mode.md)
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

## References

- [Pierre — diffs.com](https://diffs.com) — inspiration for the git-mode diff
  review experience: the split / stacked layout, progressive context folding,
  and focusing on the first change rather than the top of the file.
- [shiki](https://shiki.style) — syntax highlighting for the git diff view
  and the source of the bundled theme catalog.
- [herdr](https://github.com/ogulcancelik/herdr) by @ogulcancelik — the
  per-CLI assistant status heuristics (working / waiting-input / idle)
  used in the workspace bar are adapted from herdr's `detect.rs` rule tables.

## License

MIT © BrimVeyn
