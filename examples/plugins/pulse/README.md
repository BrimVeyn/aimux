# Pulse

A pane beside your agent, showing what aimux knows about its own use.

```ts
// aimux.config.ts
keymaps: (k) =>
  k.mode('navigation', (m) =>
    m
      .map('<leader>p', k.plugin('aimux-examples.pulse.open'))
      .map('<leader>P', k.plugin('aimux-examples.pulse.close'))
  )
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

A pane never takes the keyboard: `<leader>p` opens it beside your terminal and
the terminal keeps the cursor. That is aimux's rule, not this plugin's — see
`docs/developer/plugins.md`.
