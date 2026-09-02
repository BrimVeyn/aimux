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

- **subprocesses in the daemon half**, and two sources for one shape
- **`ctx.projects` / `ctx.workspaces`**, including why `path` and `repoRoot`
  are different fields
- **`ctx.ui.state`** — the UI half knows which project it is in and says so in
  the request
- **UI → daemon RPC with an answer** (`ctx.rpc.call`), unlike `sysload`'s
  broadcast in the other direction
- a **drawn grid**: seven rows, one per weekday, shaded relative to the
  busiest day rather than to fixed thresholds

## Two sources, and it says which

First `gh api graphql` for the signed-in account's contribution calendar. If
`gh` is missing, not authenticated, or offline, it falls back to `git log` in
the repository the current project points at — and the widget then says
`this repo only`, because an account's contributions and one repo's history are
different claims and should not look alike.

To skip GitHub entirely:

```ts
plugins: [{ id: 'aimux-examples.ghstreak', config: { preferGithub: false } }]
```

## The part it had to guess

Nothing about the data — but the _shading_ is a choice. Four levels relative to
your busiest day, so someone who commits twice a day and someone who commits
forty times both see a grid rather than a flat wall. Fixed thresholds would be
honest about volume and useless about rhythm.
