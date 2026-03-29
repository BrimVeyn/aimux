# aimux

A terminal multiplexer for AI CLIs. Manage multiple AI assistant sessions (Claude, Codex, OpenCode) side by side in a single terminal with tabbed navigation and persistent state.

![Built with Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1)
![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6)

## Features

- **Multi-tab sessions** -- Run Claude, Codex, and OpenCode in parallel with instant tab switching
- **Full terminal emulation** -- Powered by xterm.js with mouse tracking, alternate buffer, and scrollback
- **Vim-style navigation** -- `j`/`k` to switch tabs, `i` to enter input mode, familiar keybindings throughout
- **Session persistence** -- Workspace state saved to `~/.config/aimux.json` and restored on restart
- **Daemon mode** -- Background daemon keeps sessions alive across terminal restarts
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
```

## Keyboard Shortcuts

### Navigation Mode

| Key | Action |
|---|---|
| `Ctrl+N` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+R` | Restart tab |
| `j` / `k` | Next / previous tab |
| `Shift+J` / `Shift+K` | Reorder tabs |
| `i` | Enter terminal input mode |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+C` | Quit |

### Input Mode

All keystrokes pass through to the AI CLI. Press `Escape` to return to navigation mode.

### New Tab Modal

| Key | Action |
|---|---|
| `j` / `k` | Select assistant |
| `Enter` | Confirm |
| `e` | Edit custom command |
| `Esc` | Cancel |

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
```

## License

Private
