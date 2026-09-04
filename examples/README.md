# Example plugins

Nine plugins that exist to be read, and to keep the plugin API honest.

They are in this repository rather than in a gallery somewhere because they are
typechecked with it: `bun run check` covers `examples/`, so a change to
`@brimveyn/aimux-plugin` that would break a real plugin breaks the build here
first. Every one of them was written before the API had what it needed, and
each found something — that is why they exist.

| Plugin     | Shows                                                                   |
| ---------- | ----------------------------------------------------------------------- |
| `shifter`  | status-bar tile, keybindings, config, UI → daemon RPC, `tabs.send`      |
| `sysload`  | bar widget, a polling daemon half, daemon → UI broadcast                |
| `ghstreak` | subprocess in the daemon, `ctx.projects`, a drawn grid                  |
| `pulse`    | a pane, `ctx.metrics`, `ctx.ui.state`                                   |
| `lazygit`  | a pane that runs a program, declared in the manifest                    |
| `palette`  | `ctx.commands`, titled actions, `ctx.ui.layout`, git in writing         |
| `ntfy`     | the notification slot (`notifications.provide`), a secret token         |
| `tokens`   | `ctx.assistants.session/usage/resume`, a stats page, `tab:turnComplete` |
| `journal`  | a supervised service, `aimux events follow`, `registerCommand`          |

## Trying one

```bash
cd examples/plugins/shifter
aimux plugin link .
aimux plugin doctor .
aimux plugin log aimux-examples.shifter
```

Linking is the whole setup: each manifest declares where its widget goes and
which keys run its actions, and the host applies that on load and withdraws it
on unload. Nothing to write in `aimux.config.ts`, and no restart — though what
you write there still outranks anything a plugin asks for.

They are not registered by default: linking one is a deliberate act, and these
write to your terminals.

The hand-written layer can override or unbind contributed keys:

```ts
plugins: [
  {
    id: 'aimux-examples.pulse',
    keymaps: { open: '<leader>u', close: null },
  },
]
```

## What they are not

Not a component library, and not a style guide for TypeScript. They are the
shortest honest version of nine real things, and each one names in its README
the part where it had to guess — a model alias, a GPU counter — so you can
point it at what your machine actually has.
