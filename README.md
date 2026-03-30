# aimux

A terminal multiplexer for AI CLIs. Manage multiple AI assistant sessions (Claude, Codex, OpenCode) side by side in a single terminal with tabbed navigation and persistent state.

![Built with Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1)
![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6)

![aimux demo](assets/demo.gif)

## Features

- **Multi-tab sessions** -- Run Claude, Codex, and OpenCode in parallel with instant tab switching
- **Full terminal emulation** -- Powered by xterm.js with mouse tracking, alternate buffer, and scrollback
- **Vim-style navigation** -- `j`/`k` to switch tabs, `i` to enter input mode, familiar keybindings throughout
- **Session management** -- Create, rename, delete, and switch between named sessions with `Ctrl+G`
- **Session persistence** -- Workspace state saved to `~/.config/aimux/` and restored on restart
- **Daemon mode** -- Background daemon keeps sessions alive across terminal restarts
- **Live activity indicators** -- Animated spinner for busy tabs, colored indicators for idle/focused states
- **Built-in help** -- Press `?` to see all keybindings at a glance
- **Rich TUI** -- Sidebar with assistant info, status bar, and modal dialogs built with OpenTUI + React

## Install

```bash
bun install
```

## Usage

```bash
# Start aimux
bun run start

# Development mode (auto-reload)
bun run dev

# Diagnose setup issues
bun run start -- doctor

# Restart the background daemon
bun run restart-daemon
```

## Keyboard Shortcuts

Press `?` in navigation mode to see the full keybinding reference.

### Navigation Mode

| Key                   | Action                    |
| --------------------- | ------------------------- |
| `j` / `k`             | Next / previous tab       |
| `Shift+J` / `Shift+K` | Reorder tabs              |
| `i`                   | Enter terminal input mode |
| `Ctrl+N`              | New tab                   |
| `Ctrl+W`              | Close tab                 |
| `Ctrl+R`              | Restart tab               |
| `Ctrl+G`              | Session picker            |
| `Ctrl+B`              | Toggle sidebar            |
| `Ctrl+H` / `Ctrl+L`   | Resize sidebar            |
| `?`                   | Show help                 |
| `Ctrl+C`              | Quit                      |

### Input Mode

All keystrokes pass through to the AI CLI. Press `Ctrl+Z` to return to navigation mode.

### Session Picker

| Key       | Action            |
| --------- | ----------------- |
| `j` / `k` | Navigate sessions |
| `Enter`   | Resume session    |
| `n`       | New session       |
| `r`       | Rename session    |
| `d`       | Delete session    |
| `Esc`     | Cancel            |

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
```

## Tech Stack

- [Bun](https://bun.sh) -- Runtime and toolchain
- [React](https://react.dev) + [OpenTUI](https://github.com/anthropics/opentui) -- Terminal UI framework
- [xterm.js](https://xtermjs.org) (headless) -- Terminal emulation
- [bun-pty](https://github.com/nicolo-ribaudo/bun-pty) -- Native PTY spawning

## Development

```bash
# Run tests
bun test

# Type check
bun run check

# Record demo GIF (requires vhs)
bun run demo
```

## License

Private
