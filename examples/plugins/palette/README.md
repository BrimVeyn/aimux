# Command palette

Everything plugins have made runnable, in one pane you can run it from.

`<leader>c` opens it beside the agent. Walk into it with the ordinary
pane-navigation keys; then `j`/`k` move, `⏎` runs, `r` refreshes, `q` closes.
All of that is asked for by the manifest, in the pane's own mode:

```jsonc
"contributes": {
  "keymaps": [
    { "mode": "navigation", "key": "<leader>c", "action": "open" },
    { "mode": "plugin.pane.aimux-examples.palette.commands", "key": "j", "action": "down" },
    { "mode": "plugin.pane.aimux-examples.palette.commands", "key": "<CR>", "action": "run" }
    // …
  ]
}
```

## What it demonstrates

- **`ctx.commands.list()`** — actions with a title, manifest `commands[]` and
  CLI verbs, from every plugin, folded into one list
- **`ctx.commands.run(id)`** — fires an action the way its key would
- **`ctx.ui.layout`**: four of the entries it contributes are `split` and
  `swap`, the layout as an API rather than as keys
- **`ctx.ui.git.stage` / `unstage`** — two more entries, git in writing, on
  the files the git panel already lists
- a **pane with its own keys**: `j`, `k`, `⏎`, `r`, `q` live in
  `plugin.pane.aimux-examples.palette.commands`, a mode the host creates for
  the pane and nobody else can bind

## Three kinds, one list, one that runs

`▸` is an action: it runs from the palette. `⚙` is a subprocess a plugin
declared in `commands[]`, and `$` a CLI verb a daemon plugin registered — both
are the daemon's to run, so the palette shows the command line that does it
(`aimux <plugin> <command>`) rather than pretending to. `aimux action list` is
the same list from outside.

## What it does not do

Filter as you type. A plugin action is told _that_ its key was pressed, never
_which_ key, so there is nothing to append to a query. The list is short
enough to walk; when it is not, bind the entry you want directly:

```ts
keymaps: (k) =>
  k.mode('navigation', (m) => m.map('<leader>s', k.plugin('aimux-examples.palette.stage-all')))
```

## The part it had to guess

That an action worth listing has a title. One without lists under its verb —
`aimux-examples.pulse.open` rather than "Open Pulse" — which is the whole
argument for `actions.register(verb, handler, { title })`.
