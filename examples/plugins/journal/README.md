# Journal

Everything that happens in aimux — a tab changing status, a turn ending, a
workspace appearing — written down by a shell script, and read back in a pane
under the agent.

`<leader>j` shows and hides the pane. The rest runs on its own from the moment
the plugin is linked:

```jsonc
"services": [{ "id": "follow", "command": ["sh", "bin/follow.sh"], "restart": "always" }]
```

## What it demonstrates

- a **supervised service** (`services[]`): a process the daemon starts when
  the plugin is enabled, stops when it is not, and — with `restart: always` —
  brings back after a daemon restart ends the stream. `aimux plugin services`
  shows its pid and restart count; its stderr lands in `aimux plugin log`
- **`aimux events follow`**: the fourteen daemon events as NDJSON, consumed by
  a POSIX shell with a redirect. No SDK
- the **`AIMUX_*` environment** a service runs with — the state directory to
  write in, the binary to call back with
- **`ctx.ui.panes.registerCommand`** from code, with an argv the manifest could
  not have written because it contains a path only the UI half knows
- **`cwd: 'plugin'`**, the third answer to "where does the program run"

## Two processes, one file

The service (`bin/follow.sh`) appends; the pane (`src/tail.ts`) reads. They
never talk. The file is the contract, and it is in `plugins-state/` because
it is disposable: delete it and the next event starts a new one.

```
~/.config/aimux/<profile>/plugins-state/aimux-examples.journal/journal.ndjson
```

The pane program is the plugin's own — a Bun script it ships — which is the
other thing a command pane is for beyond lazygit: a viewer you wrote, beside
the agent, in any language.

## The part it had to guess

Where `aimux` is. A service is told `AIMUX_BIN_PATH`, the executable running
the daemon. Installed, that _is_ aimux. Linked from a checkout, it is `bun`
and the CLI is the checkout's entry point — which this plugin knows only
because it lives in that checkout. A plugin of yours, outside the repo,
should take `AIMUX_BIN_PATH` at its word.
