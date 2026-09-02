# Recipes

One short, complete recipe per surface. Every one of them is real code against
the current API — copy it, rename it, delete the parts you do not need.

Signatures live in `api.md`; this page is about which surface to reach for.

Two things are true of every recipe and are never repeated below: the register
call returns a disposer that the host has **already** recorded, so you do not
have to keep it; and every id you pass is namespaced by the host, so `board`
becomes `acme.thing.board` everywhere it is later named.

---

## UI half

### A bar widget

Placed and resized like `git` and `projects`, and named in a user's `bars`
config by its qualified id.

```tsx
ctx.ui.widgets.register({
  id: 'board',
  label: 'Board',
  render: (contentWidth) => {
    const { Panel, Row } = ctx.ui.kit
    return (
      <Panel title="Board">
        <Row label="Width" value={String(contentWidth)} />
      </Panel>
    )
  },
})
```

### A full-screen view

Replaces the pane tree until closed — the shape a board, a log browser or a
diff viewer wants.

```tsx
ctx.ui.views.register({ id: 'board', title: 'Board', render: () => <Board /> })
ctx.ui.views.open('board') // unqualified: the host adds the prefix
ctx.ui.views.close()
```

### A modal

```tsx
ctx.ui.modals.register({
  id: 'confirm',
  title: 'Are you sure?',
  render: (props) => <Confirm {...(props as ConfirmProps)} />,
})
ctx.ui.modals.open('confirm', { what: 'delete the board' })
```

Closed by aimux's ordinary close-modal path, so `esc` works without you.

### A keybinding

Two halves: an action decides _what_, an effect is allowed to _do_.

```ts
ctx.actions.register('open', () => ({
  actions: [],
  effects: [{ type: 'plugin-effect', pluginId: ctx.id, effectId: 'openBoard' }],
}))
ctx.actions.effect('openBoard', () => ctx.ui.views.open('board'))
```

The user binds it by name, in `aimux.config.ts`:

```ts
keymaps: (k) => k.mode('navigation', (m) => m.map('<leader>b', k.plugin('acme.thing.open')))
```

A name and not a function, because the keymap resolves before plugins load. An
unresolved name is inert — the key does nothing, like an unbound key.

### Plugin state

Your own slice of the app state, opaque to aimux's reducer.

```ts
interface Slice {
  count: number
}

ctx.store.reducer<Slice>((slice = { count: 0 }, action) =>
  action.actionId === 'bump' ? { count: slice.count + 1 } : slice
)
ctx.store.dispatch('bump')
ctx.store.get<Slice>()?.count
```

### A settings section

Most plugins need none: declaring `config` in the manifest generates rows
already. Register one when a row has to compute something.

```ts
ctx.ui.settings.registerSection({
  id: 'board',
  label: 'Board',
  glyph: '■',
  rows: [{ id: 'board.path', kind: 'info', label: 'Data file', value: () => ctx.paths.state }],
})
```

### Reading one of aimux's own settings

For the case where your plugin must agree with aimux about something the user
already set. `watch` fires immediately as well as on change.

```ts
ctx.ui.settings.watch('theme.beta.harmonizeClaudeTheme', (value) => {
  if (value === true) start()
  else stop()
})
```

### A theme, and the active one

```ts
ctx.ui.themes.register('midnight', midnightThemeJson)

const { colors, mode } = ctx.ui.themes.current() // outside React
ctx.ui.themes.onChange((snapshot) => writePalette(snapshot.colors))
```

Inside a component use `ctx.ui.kit.useTheme()`. Never hard-code a colour: aimux
ships 34 themes and loads more from disk, and a plugin with its own palette is
the part of the screen that stops matching when the user switches.

### A stats page

```tsx
ctx.ui.stats.registerPage({ id: 'board', label: 'Board', glyph: '◆', render: () => <Stats /> })
```

### A status bar tile

Sits on the right, before the version. aimux draws the separators and the tile
colours; you render content.

```tsx
ctx.ui.statusBar.register({ id: 'quota', render: () => <Quota /> })
```

Register it only while it has something to say — a tile that renders nothing
still costs a tile and two separators.

---

## Daemon half

### React to what an agent did

```ts
ctx.on('tab:turnComplete', ({ tabId, projectId, idleMs }) => {
  ctx.log.info('a turn finished', { idleMs, projectId, tabId })
})
```

The vocabulary: `tab:status`, `tab:turnComplete`, `tab:question`, `tab:added`,
`project:status`, `project:created`, `project:switched`, `project:closed`,
`workspace:added`, `workspace:removed`, `daemon:reexec`.

### Drive a tab

```ts
const tabId = await ctx.tabs.spawn({
  assistant: 'claude',
  command: 'claude',
  projectId,
  title: 'review',
})
await ctx.tabs.send(tabId, 'review the diff\r') // bytes: the newline is yours
const screen = ctx.tabs.snapshot(tabId, 40)
```

`spawn` is sized from the project's last attached dimensions — a plugin has no
viewport — so it fails clearly if no UI has ever attached to that project.

### A whole assistant

Spawn command, status classifier, question parser, quota adapter and hook
mapping are declared together, because from the outside they are one thing.

```ts
ctx.assistants.register({
  option: { id: 'acme.robot', label: 'Acme robot', command: 'acme-robot' },
  detectStatus: ({ haystack }) => (haystack.includes('whirring') ? 'working' : null),
  extractOptions: ({ lines }) => parseMyMenu(lines),
  usage: async (config) => fetchMyQuota(config),
  hooks: { mapEvent: (name) => (name === 'TurnEnded' ? 'idle' : null), urlEnvVar: 'ACME_HOOK_URL' },
})
```

`null` from a classifier means "no opinion" and hands over to the generic
heuristic — the same contract the built-ins have.

### An HTTP hook route

```ts
ctx.hooks.route('events', (event) => ctx.log.info('hook', { event }))
const url = ctx.hooks.url('events') // hand this to your bridge script
```

The path is namespaced: `/hook/acme.thing.events` cannot collide with another
plugin's, or with `claude`.

### A CLI verb

```ts
ctx.cli.register({
  group: 'robot',
  verb: 'ping',
  summary: 'Ping the robot',
  run: async ({ positionals }) => ({ pong: positionals, tabs: ctx.tabs.list().length }),
})
```

Gives you `aimux robot ping hello`, completion included. It runs in the daemon;
whatever `run` returns is the command's JSON on stdout.

### Talk to your other half

```ts
// daemon
ctx.rpc.handle('summary', async () => ({ tabs: ctx.tabs.list().length }))
// ui
const summary = await ctx.rpc.call<{ tabs: number }>('summary')
```

`broadcast` for a fact nobody waits on, `call` for an answer. Never a socket of
your own.

---

## No TypeScript at all

A manifest with `commands[]` and no `entries` is a plugin. Each command is an
argv the daemon spawns; the script talks back through the `aimux` CLI it
already has.

```jsonc
{
  "id": "acme.notify",
  "version": "0.1.0",
  "apiVersion": 1,
  "commands": [{ "id": "ping", "title": "Ping", "command": ["./notify.sh"] }],
}
```

```sh
#!/bin/sh
set -eu
"$AIMUX_BIN_PATH" tab send --tab "$1" "ping\r"
```

Run it with `aimux plugin exec acme.notify ping`. The environment carries
`AIMUX_BIN_PATH`, `AIMUX_SOCKET_PATH`, `AIMUX_PLUGIN_ID`, `AIMUX_PLUGIN_ROOT`,
`AIMUX_PLUGIN_CONFIG_DIR`, `AIMUX_PLUGIN_STATE_DIR`, `AIMUX_CONTEXT_JSON` and
`AIMUX_ENV=1`.

---

## Anything with a lifetime

Timers, watchers, sockets, subscriptions to something outside aimux — none of
them are registrations, so none of them are recorded for you. Wrap them:

```ts
ctx.effect(() => {
  const timer = setInterval(poll, 30_000)
  return () => clearInterval(timer)
})
```

A plugin holding a module-level `setInterval` survives its own unload, and no
amount of care elsewhere fixes that.
