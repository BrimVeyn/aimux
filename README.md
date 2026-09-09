# aimux

A terminal multiplexer for AI CLIs. Run Claude, Codex, OpenCode and normal
shell tabs side by side in one TUI, across several projects at once, with
git worktrees per branch, an in-app diff and pull-request review, split panes,
snippets, themes, plugins, and fully configurable keymaps.

![Built with Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1)
![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6)
![MIT License](https://img.shields.io/badge/license-MIT-blue)

![aimux demo](assets/demo.gif)

## Features

- multi-project workflow with a dedicated project picker
- tabs for `claude`, `codex`, `opencode`, `grok`, `kimi`, `antigravity`, and
  `terminal`
- split panes with pane focus and resize shortcuts
- persistent projects with saved layout and tab state
- profile-isolated config, catalogs, daemon sockets, and runtime state
- typed keymap customization through `@brimveyn/aimux-config`
- snippets catalog and snippet picker
- configurable git pane (embedded in the sidebar or as a standalone pane) and a
  dedicated [git mode](docs/guide/git-mode.md) for review / stage / commit /
  push with a split or stacked diff view and shiki-powered highlighting
- the same pane's `github` tab (`g`) reads the branch's open pull request
  through `gh` — title, body, and every CI check with its state and duration
- [git worktrees](docs/guide/workspaces.md) for running agents on parallel
  branches — create per-branch workspaces, review each against its base, and
  squash-move a workspace's work into another
- a [plugin system](docs/guide/plugins.md) with its own typed API, plus
  `aimux plugin` to search, install and link them
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
  projectBar: {
    initialPosition: 'top',
    initialVisible: true,
  },

  keymaps: (k) =>
    k.mode('navigation', (m) => m.map('<C-g>', actions.projectPicker, 'Project picker')),
})
```

Typed config is startup intent, not app-managed persisted state. Fields like
`projectBar.initialVisible` and `projectBar.initialPosition` are reapplied on
every launch, so runtime UI changes for those fields do not stick while the
config entry remains set.

Then start the app:

```bash
aimux
```

On first launch, use the project picker flow to create your first project.

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
- `aimux-projects.json` - project catalog and project snapshots
- `aimux-snippets.json` - snippet catalog

Rule of thumb:

- `aimux.config.ts` declares startup intent
- `aimux.json` stores app-managed runtime preferences
- runtime actions never rewrite `aimux.config.ts`

See [`docs/concepts/config-and-state.md`](docs/concepts/config-and-state.md).

### Projects

A project is a repository you add by picking a folder. Inside it live
workspaces (git worktrees), and inside those live tabs — one creation action
per level: `Ctrl+G` for a project, `Ctrl+P` for a workspace, `Ctrl+N` for a
tab. A project can have:

- a name
- an optional project directory
- a persisted project snapshot
- an order in the project bar and project picker

See [`docs/guide/projects.md`](docs/guide/projects.md).

### Keymaps

Keymaps are defined through `@brimveyn/aimux-config` and merged with shipped
defaults at startup.

Important runtime fact:

- the shipped leader key is `Ctrl+W`

See [`docs/guide/keymaps.md`](docs/guide/keymaps.md).

## Default Everyday Shortcuts

- `?` - open help
- `i` - focus terminal, `Ctrl+Z` - leave it
- `h` / `l` - previous / next tab, `j` / `k` - previous / next project
- `r` - rename tab, `d d` - close tab, `S` - flash jump
- `Ctrl+N` - new tab, `Ctrl+P` - new workspace, `Ctrl+G` - project picker
- `Ctrl+S` - snippet picker, `Ctrl+T` - theme picker
- `Ctrl+B` - toggle sidebar
- `Ctrl+D` - enter git mode, `G` - toggle the git pane, `g` - its diff /
  github tabs
- `Ctrl+W` is the leader: `Ctrl+W b` project bar, `Ctrl+W u` stats,
  `Ctrl+W ,` settings, `Ctrl+W 1` … `Ctrl+W 9` switch tab by index
- in a terminal: `Ctrl+W |` / `Ctrl+W -` split, `Ctrl+W h j k l` focus a pane

The help modal reflects the resolved keymap, so it includes your overrides.

## CLI

```bash
aimux
aimux worker doctor
aimux worker run --name investigate --assistant claude "inspect this repository"
aimux project list
aimux tab create --assistant claude --new-workspace
aimux plugin search git
aimux profile list
aimux completion install --shell zsh
aimux version
aimux doctor
aimux update
aimux restart-daemon
aimux restart-terminal-manager
```

See [`docs/reference/cli.md`](docs/reference/cli.md) for behavior details.

For agent orchestration, prefer the named `aimux worker` commands. They combine
isolated workspace creation, prompt dispatch, authoritative turn waiting, fleet
inspection, and guarded cleanup without shell wrappers or `jq`. Pin the target
with `--project` (or `AIMUX_PROJECT`) for anything long-running: the default
follows whichever project the UI opened last.

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
- [`docs/guide/projects.md`](docs/guide/projects.md)
- [`docs/guide/workspaces.md`](docs/guide/workspaces.md)
- [`docs/guide/git-mode.md`](docs/guide/git-mode.md)
- [`docs/guide/keymaps.md`](docs/guide/keymaps.md)
- [`docs/guide/themes.md`](docs/guide/themes.md)
- [`docs/guide/settings.md`](docs/guide/settings.md)
- [`docs/guide/snippets.md`](docs/guide/snippets.md)
- [`docs/guide/plugins.md`](docs/guide/plugins.md)
- [`docs/guide/claude-integration.md`](docs/guide/claude-integration.md)
- [`docs/guide/ai-usage-indicator.md`](docs/guide/ai-usage-indicator.md)
- [`docs/guide/usage-history.md`](docs/guide/usage-history.md)
- [`docs/reference/cli.md`](docs/reference/cli.md)
- [`docs/reference/config-reference.md`](docs/reference/config-reference.md)
- [`docs/reference/plugin-api.md`](docs/reference/plugin-api.md)
- [`docs/reference/runtime-paths.md`](docs/reference/runtime-paths.md)
- [`docs/developer/architecture.md`](docs/developer/architecture.md)
- [`docs/developer/plugins.md`](docs/developer/plugins.md)
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
bun run knip
```

The GIF at the top is reproducible: `bun run demo` seeds a throwaway `demo`
profile and records [`assets/demo.tape`](assets/demo.tape) with
[vhs](https://github.com/charmbracelet/vhs). The tape's header says what it
needs.

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
  used in the project bar are adapted from herdr's `detect.rs` rule tables.

## License

MIT © BrimVeyn
