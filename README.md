# aimux

A terminal multiplexer for AI CLIs. Manage multiple AI assistant sessions (Claude, Codex, OpenCode) side by side in a single terminal with tabbed navigation, split panes, persistent sessions, and fully configurable keybindings.

![Built with Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1)
![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6)
![MIT License](https://img.shields.io/badge/license-MIT-blue)

![aimux demo](assets/demo.gif)

## Features

- **Multi-tab sessions** — Run Claude, Codex, and OpenCode in parallel with instant tab switching
- **Split panes** — Split vertically (`|`) or horizontally (`-`) to view multiple assistants at once
- **Draggable separators** — Resize split panes by dragging with the mouse
- **Click-to-focus** — Click any pane or sidebar tab to focus it instantly
- **Full terminal emulation** — Powered by xterm.js with mouse tracking, alternate buffer, and scrollback
- **Configurable nvim-style keymaps** — Define keybinds in a typed `aimux.config.ts` with leader keys, multi-key sequences, and a prefix-trie resolver
- **Text selection** — Double-click for a word, triple-click for a line, drag for a region. Selections copy to system clipboard automatically
- **Project-scoped sessions** — Associate a git repository with each session; all tabs spawn in that directory
- **Directory picker** — Fuzzy-search git repos and worktrees from `$HOME` using `fzf`
- **Session persistence** — Workspace state (tabs, titles, layout) saved and restored on restart
- **Git status panel** — Branch + diff summary in the sidebar
- **Daemon mode** — Background daemon keeps sessions alive across terminal restarts
- **Snippets** — Save and reuse prompt snippets across sessions
- **Theme picker** — Switch between 11 built-in themes on the fly
- **Pending-chord indicator** — Bottom-right overlay shows mid-sequence key state (like nvim's `which-key`)
- **Built-in help** — Press `?` to see all keybindings

### Session Management

![Session management](assets/sessions.gif)

### Multi-Tab Workflow

![Multi-tab workflow](assets/tabs.gif)

### Themes

![Themes](assets/themes.gif)

### Split Panes

![Split panes](assets/splits.gif)

## Install

```bash
bun install -g @brimveyn/aimux
```

Requires [Bun](https://bun.sh).

## Usage

```bash
aimux                  # start the TUI
aimux version          # print version
aimux doctor           # check setup
aimux update           # self-update
aimux restart-daemon   # restart background daemon
```

## Configuration

aimux reads `~/.config/aimux/aimux.config.ts` at startup. Set it up with:

```bash
mkdir -p ~/.config/aimux && cd ~/.config/aimux
bun init -y
bun add -d @brimveyn/aimux-config
```

Then create `~/.config/aimux/aimux.config.ts`:

```ts
import { defineConfig, actions, themes } from '@brimveyn/aimux-config'

export default defineConfig({
  theme: themes.extend('tokyo-night', { accent: '#ff9e64' }),

  keymaps: (k) => k
    .leader('<Space>')
    .timeout(300)
    .mode('navigation', (m) => m
      .map('j', actions.nextTab)
      .map('k', actions.prevTab)
      .map('<leader>g', actions.sessionPicker)
      .group('<leader>t', 'tabs', (g) => g
        .map('n', actions.newTab)
        .map('r', actions.renameTab)
        .map('x', actions.closeTab)))
    .mode('layout', (m) => m
      .map('|', actions.splitVertical)
      .map('-', actions.splitHorizontal)),
})
```

User bindings override defaults. Use `.unmap(keys)` to remove a default. See [`@brimveyn/aimux-config`](packages/aimux-config/README.md) for the full builder API.

### Key notation

| Notation        | Meaning                        |
| --------------- | ------------------------------ |
| `j`             | Bare character                 |
| `J`             | Shift+J (uppercase letter)     |
| `<C-n>`         | Ctrl+N                         |
| `<M-x>`         | Meta/Alt+X                     |
| `<CR>` `<Esc>`  | Return / Escape                |
| `<leader>`      | Configured leader chord        |
| `dd`            | Multi-key sequence             |
| `<leader>tn`    | Leader, then t, then n         |

## Default Keymaps

Press `?` in navigation mode for the full, live keybinding list (reflects your config).

### Navigation Mode

| Key                   | Action                    |
| --------------------- | ------------------------- |
| `j` / `k`             | Next / previous tab       |
| `Shift+J` / `Shift+K` | Reorder tabs              |
| `i`                   | Enter terminal input      |
| `r`                   | Rename active tab         |
| `dd`                  | Close active tab          |
| `Ctrl+N`              | New tab                   |
| `Ctrl+R`              | Restart tab               |
| `Ctrl+G`              | Session picker            |
| `Ctrl+B`              | Toggle sidebar            |
| `Ctrl+H` / `Ctrl+L`   | Resize sidebar            |
| `Ctrl+S`              | Snippet picker            |
| `Ctrl+T`              | Theme picker              |
| `G`                   | Toggle git panel          |
| `?`                   | Show help                 |
| `Ctrl+C`              | Quit                      |

### Terminal Input Mode

Keystrokes pass through to the active tab's PTY. Configured shortcuts:

| Key              | Action                       |
| ---------------- | ---------------------------- |
| `Ctrl+Z`         | Leave to navigation          |
| `<leader>`       | Enter layout mode            |
| `Ctrl+B`         | Toggle sidebar               |

### Layout Mode

| Key                   | Action             |
| --------------------- | ------------------ |
| `\|`                  | Split vertical     |
| `-`                   | Split horizontal   |
| `h` / `j` / `k` / `l` | Focus pane         |
| `Shift+H/J/K/L`       | Resize pane        |
| `q`                   | Close pane         |
| `Esc`                 | Back to input      |

## Architecture

```
aimux/
├── packages/
│   └── aimux-config/          # published as @brimveyn/aimux-config
│       └── src/               # types, builder, actions, themes, defaults
└── src/                       # the CLI (published as @brimveyn/aimux)
    ├── index.tsx              # entry point + CLI dispatcher
    ├── app.tsx                # main React app + state wiring
    ├── config/
    │   └── loader.ts          # loads aimux.config.ts
    ├── ui/                    # OpenTUI React components
    ├── state/                 # reducers + app store
    ├── pty/                   # PTY and terminal emulation
    ├── session-backend/       # local and daemon backends
    ├── daemon/                # background session daemon
    ├── ipc/                   # daemon protocol
    └── input/
        ├── modes/             # mode registry + transitions
        ├── keymap/            # prefix trie + sequence resolver
        └── raw-input-handler.ts
```

## Tech Stack

- [Bun](https://bun.sh) — Runtime and toolchain
- [React](https://react.dev) + [OpenTUI](https://github.com/sst/opentui) — Terminal UI framework
- [xterm.js](https://xtermjs.org) (headless) — Terminal emulation
- [bun-pty](https://github.com/nicolo-ribaudo/bun-pty) — Native PTY spawning
- [Zustand](https://zustand-demo.pmnd.rs/) — State store

## Development

```bash
git clone https://github.com/BrimVeyn/aimux && cd aimux
bun install

bun run dev              # auto-reload dev mode
bun run start            # run from source
bun test                 # run test suite
bun run check            # typecheck
bun run lint             # oxlint
```

## License

MIT © BrimVeyn
