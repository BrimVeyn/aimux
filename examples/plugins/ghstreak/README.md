# Commit grid

A year of commits as a grid, in a bar widget.

```ts
bars: {
  left: {
    widgets: ['projects', 'aimux-examples.ghstreak.commits']
  }
}
```

## What it demonstrates

- **subprocesses in the daemon half**, and three sources for one shape
- a **secret config field**, and what aimux does with one
- **`ctx.projects` / `ctx.workspaces`**, including why `path` and `repoRoot`
  are different fields
- **`ctx.ui.state`** — the UI half knows which project it is in and says so in
  the request
- **UI → daemon RPC with an answer** (`ctx.rpc.call`), unlike `sysload`'s
  broadcast in the other direction
- a **drawn grid**: seven rows, one per weekday, shaded relative to the
  busiest day rather than to fixed thresholds

## Three sources, and it says which

A configured token first — it is the explicit choice, and it works on a machine
with no `gh` installed. Then `gh api graphql` for the signed-in account. If
neither answers, it falls back to `git log` in the repository the current
project points at, and the widget says `this repo only`: an account's
contributions and one repo's history are different claims and should not look
alike.

```
aimux plugin set aimux-examples.ghstreak token --value-stdin < ~/.gh-token
```

`--value-stdin` keeps the token out of your shell history and out of `ps`.

The field is declared `secret`, which is why it is here: a token is the one
config value whose _rendering_ can leak, and aimux redacts it everywhere — the
settings row, `plugin config`, the echo from `plugin set`, the plugin log. The
plugin gets the real value in `ctx.config` and nothing else ever sees it. On
the settings screen the row reads `<secret>` and its editor opens empty,
because a secret is replaced, not edited.

To skip GitHub entirely and read the local repo only:

```ts
plugins: [{ id: 'aimux-examples.ghstreak', config: { preferGithub: false } }]
```

## The part it had to guess

Nothing about the data — but the _shading_ is a choice. Four levels relative to
your busiest day, so someone who commits twice a day and someone who commits
forty times both see a grid rather than a flat wall. Fixed thresholds would be
honest about volume and useless about rhythm.
