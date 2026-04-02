# aimux

A terminal multiplexer for AI CLIs. Manage multiple AI assistant sessions (Claude, Codex, OpenCode) side by side in a single terminal with tabbed navigation and persistent state.

![Built with Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1)
![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6)

![aimux demo](assets/demo.gif)

## Features

- **Multi-tab sessions** -- Run Claude, Codex, and OpenCode in parallel with instant tab switching
- **Split panes** -- Split vertically (`|`) or horizontally (`-`) to view multiple assistants at once
- **Draggable separators** -- Resize split panes by dragging the separator with the mouse
- **Click-to-focus** -- Click any pane or sidebar tab to focus it instantly
- **Full terminal emulation** -- Powered by xterm.js with mouse tracking, alternate buffer, and scrollback
- **Vim-style navigation** -- `j`/`k` to switch tabs, `i` to enter input mode, familiar keybindings throughout
- **Text selection** -- Double-click to select a word, triple-click to select a line, drag to select a region. Selections are copied to the system clipboard automatically
- **Project-scoped sessions** -- Associate a git repository with each session; all tabs spawn in that directory
- **Directory picker** -- Fuzzy-search git repos and worktrees from `$HOME` using `fzf` when creating sessions
- **Session management** -- Create, rename, delete, filter, and switch between sessions with `Ctrl+G`
- **Session search** -- Press `/` in the session picker to filter sessions by name or project path
- **Tab renaming** -- Press `r` to rename tabs for easy identification across multiple assistant instances
- **Session persistence** -- Workspace state (tabs, titles, layout) saved to `~/.config/aimux/` and restored on restart
- **Git branch display** -- Current branch shown in the sidebar for project-scoped sessions
- **Daemon mode** -- Background daemon keeps sessions alive across terminal restarts
- **Live activity indicators** -- Animated spinner for busy tabs, colored indicators for idle/focused states
- **Snippets** -- Save and reuse prompt snippets across sessions with `Ctrl+S`
- **Theme picker** -- Switch between themes on the fly with `Ctrl+T`
- **Built-in help** -- Press `?` to see all keybindings at a glance
- **Rich TUI** -- Sidebar with git info, status bar with session context, and modal dialogs built with OpenTUI + React

### Session Management

Create project-scoped sessions, switch between them, and filter by name:

![Session management](assets/sessions.gif)

### Multi-Tab Workflow

Run multiple AI assistants side by side, rename tabs, and navigate with vim keys:

![Multi-tab workflow](assets/tabs.gif)

### Themes

Switch between 9 built-in themes on the fly:

![Themes](assets/themes.gif)

### Split Panes

Split your workspace into multiple panes and resize them by dragging:

![Split panes](assets/splits.gif)

## Install

```bash
bun install -g github:BrimVeyn/aimux
```

## Usage

```bash
# Start aimux
aimux

# Update to latest version
aimux update

# Diagnose setup issues
aimux doctor

# Restart the background daemon
aimux restart-daemon
```

## Keyboard Shortcuts

Press `?` in navigation mode to see the full keybinding reference.

### Navigation Mode

| Key                   | Action                    |
| --------------------- | ------------------------- |
| `j` / `k`             | Next / previous tab       |
| `Shift+J` / `Shift+K` | Reorder tabs              |
| `i`                   | Enter terminal input mode |
| `r`                   | Rename active tab         |
| `Ctrl+N`              | New tab                   |
| `Ctrl+W`              | Close tab                 |
| `Ctrl+R`              | Restart tab               |
| `Ctrl+G`              | Session picker            |
| `Ctrl+B`              | Toggle sidebar            |
| `Ctrl+H` / `Ctrl+L`   | Resize sidebar            |
| `Ctrl+S`              | Snippet picker            |
| `Ctrl+T`              | Theme picker              |
| `?`                   | Show help                 |
| `Ctrl+C`              | Quit                      |

### Input Mode

All keystrokes pass through to the AI CLI. Press `Ctrl+Z` to return to navigation mode.

### Layout Mode

Enter with `Ctrl+W` from input mode. Manage split panes:

| Key              | Action           |
| ---------------- | ---------------- |
| `\|`             | Split vertical   |
| `-`              | Split horizontal |
| `h` / `j` / `k` / `l` | Focus pane       |
| `Shift+H/J/K/L` | Resize pane      |
| `q`              | Close pane       |
| `Esc`            | Back to navigation |

### Session Picker

| Key       | Action            |
| --------- | ----------------- |
| `j` / `k` | Navigate sessions |
| `Enter`   | Resume session    |
| `n`       | New session       |
| `r`       | Rename session    |
| `d`       | Delete session    |
| `/`       | Filter sessions   |
| `Esc`     | Cancel            |

### Create Session Modal

| Key        | Action                          |
| ---------- | ------------------------------- |
| `Tab`      | Switch between directory / name |
| `Ctrl+N/P` | Navigate search results         |
| `Enter`    | Select directory / confirm      |
| `Esc`      | Back to session picker          |

## Architecture

```
src/
  index.tsx          # Entry point and CLI mode selection
  app.tsx            # Core React app with state management
  config.ts          # Persistent configuration
  ui/                # OpenTUI React components
  state/             # Redux-style state management
  pty/               # PTY and terminal emulation
  session-backend/   # Local and daemon session backends
  daemon/            # Background session daemon
  ipc/               # Inter-process communication protocol
  input/             # Keyboard and mouse input handling
    modes/           # State-machine mode handlers (one per interaction context)
```

## Tech Stack

- [Bun](https://bun.sh) -- Runtime and toolchain
- [React](https://react.dev) + [OpenTUI](https://github.com/anthropics/opentui) -- Terminal UI framework
- [xterm.js](https://xtermjs.org) (headless) -- Terminal emulation
- [bun-pty](https://github.com/nicolo-ribaudo/bun-pty) -- Native PTY spawning

## Development

```bash
# Clone and install dependencies
git clone https://github.com/BrimVeyn/aimux && cd aimux
bun install

# Development mode (auto-reload)
bun run dev

# Run from source
bun run start

# Run tests
bun test

# Type check
bun run check

# Record demo GIFs (requires vhs)
bun run demo
bun run demo:sessions
bun run demo:tabs
bun run demo:splits
bun run demo:themes
```

## License

Private
