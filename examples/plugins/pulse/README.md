# Pulse

A pane beside your agent, showing what aimux knows about its own use.

`<leader>p` opens it, `q` closes it from inside — both asked for by the
manifest, so linking the plugin is the whole setup:

```jsonc
"contributes": {
  "keymaps": [
    { "mode": "navigation", "key": "<leader>p", "action": "open" },
    { "mode": "plugin.pane.aimux-examples.pulse.stats", "key": "q", "action": "close" }
  ]
}
```

## What it demonstrates

- a **pane** (`ctx.ui.panes`) — a leaf in the layout tree that is not a
  terminal, split beside the tab you are in
- **`ctx.metrics.counters`** through the daemon half, because reading a file on
  the render path is a stutter you feel
- **`ctx.ui.state.use`**, the live half: tabs, how many are working, which one
  you are in — re-rendering only when what it selects changes

## Two clocks in one pane

The top half is _now_: it comes from the store and updates as you work. The
bottom is _recorded_: counters aimux writes per local day, refreshed once a
minute. Keeping them visibly apart is deliberate — a number that has not moved
in an hour should not sit in the same block as one that changed while you read
it.

## What the counters are

Counts, and nothing else. `keys` is a number of key presses with no key
identity and no content attached; there is no per-keybinding breakdown, because
that would mean recording _which_ key. Nothing here leaves the machine, and
this plugin does not change that — it reads what is already on disk.

## Note on focus

Opening does not move the keyboard: `<leader>p` puts the pane beside your
terminal and the terminal keeps the cursor. Walk into it with the ordinary
pane-navigation keys, and it takes the keys — its border lights up. Its own
bindings live in its own mode, `plugin.pane.<qualified pane id>`, which is the
second entry in the manifest block above — a mode nobody had bound before the
plugin existed, and one the host creates for it.
