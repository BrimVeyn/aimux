# Model shifter

Five gears for the model the active assistant is running on, and a status-bar
tile showing which one you are in.

Its manifest asks for the two keys it needs, so linking it is enough:

```jsonc
"contributes": {
  "keymaps": [
    { "mode": "navigation", "key": "<leader>+", "action": "up" },
    { "mode": "navigation", "key": "<leader>-", "action": "down" }
  ]
}
```

A key you have already bound is never taken — the plugin's request is refused
and says so in `aimux plugin log`. The five gears are bindable the same way,
from the manifest or from your own config:

```ts
// aimux.config.ts — yours outranks the manifest, always
keymaps: (k) =>
  k.mode('navigation', (m) => m.map('<leader>3', k.plugin('aimux-examples.shifter.gear3')))
```

## What it demonstrates

- a **status bar tile** that reads back plugin state (`ctx.ui.statusBar`)
- **keybindings**: an action decides, an effect acts (`ctx.actions`)
- **plugin state** in its own slice of the app state (`ctx.store`)
- **UI → daemon RPC**, because only the daemon can type into a PTY
- **config**, because the plugin does not know your model aliases

## The part it had to guess

aimux does not know what your assistant calls its models, and neither does this
plugin — it types a line for you. The defaults assume Claude Code's `/model`
command:

| Gear | Types           |
| ---- | --------------- |
| 1    | `/model haiku`  |
| 2    | `/model sonnet` |
| 3    | `/model opus`   |
| 4    | `/model fable`  |
| 5    | `/model fable`  |

Gear 5 is meant to be Fable with reasoning turned up, and it ships pointing at
plain `fable` because inventing an alias that does not exist would be worse
than shipping one you have to set. Point it at whatever your assistant accepts:

```ts
plugins: [{ id: 'aimux-examples.shifter', config: { gear5: '/model fable --effort max' } }]
```

Every gear is configurable the same way, so the same gearbox drives Codex or
anything else that takes a slash command.

## Layout

- `src/gears.ts` — the gears, shared by both halves. Two halves are two
  processes and share no memory, but they can share a module.
- `src/ui.tsx` — the tile, the actions, the effect that calls across.
- `src/daemon.ts` — one RPC handler that types into the tab.
