# aimux GUI (experimental)

A minimal Tauri + React desktop shell for aimux. It reuses the existing aimux
backend (daemon + terminal-manager) end to end — the GUI is just another
frontend.

## Architecture

```
aimux --gui  (Bun, src/gui/host.ts)
  ├─ createSessionBackend()        → spawns/handshakes the daemon (same as the TUI)
  ├─ attach to the "gui" session   → creates one terminal tab if empty
  ├─ Bun.serve on 127.0.0.1:7878   → WebSocket bridge (browser ⇄ backend)
  └─ spawns the Tauri shell        → its WebView loads this React app

This app (desktop/)
  └─ React + Vite + Tailwind + shadcn
       └─ connects to ws://127.0.0.1:7878/ws
       └─ renders the backend's TerminalSnapshot to a DOM grid
       └─ sends keystrokes / resize / scroll back to the host
```

The terminal is rendered from the backend's already-parsed `TerminalSnapshot`
(cells with hex colors), not from raw PTY bytes — so this does **not** use
xterm.js. See `src/Terminal.tsx`. The WS message contract mirrors the host side
in `../src/gui/protocol.ts` (kept as a local copy in `src/lib/types.ts`).

## Run

From the repo root, start the GUI host (it spawns the daemon and the window):

```sh
bun run gui          # = aimux --gui
```

The host auto-launches a built **release** shell binary. Build it once:

```sh
cd desktop
bun run tauri build   # standalone release binary (auto-launched by `bun run gui`)
```

### Live development (HMR)

For iterating on the React UI with hot reload:

```sh
# terminal 1 — backend + WS host
bun run gui

# terminal 2 — Vite dev server + debug Tauri window
cd desktop && bun run tauri dev
```

The debug window loads from the Vite dev server (port 1420); the release binary
embeds the built frontend and runs standalone.

## Scope (v1)

- One GUI session (`gui`), active tab rendered full-screen, minimal tab strip.
- Type, resize, scroll, paste; create a terminal tab with `+`.
- Not yet: split panes, scrollback affordances, theming, npm packaging of the
  shell binary (built locally for now).
