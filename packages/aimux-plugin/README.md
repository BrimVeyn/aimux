# @brimveyn/aimux-plugin

Authoring API for [aimux](https://github.com/BrimVeyn/aimux) plugins.

A plugin is a directory with a manifest and up to two entry files — one per
host process. aimux loads them in-process, so a plugin renders real UI and
reacts to real events; and it unloads them by running every disposer they
registered, so editing one reloads it in place.

```
my-plugin/
  aimux-plugin.json      manifest — read without executing any code
  ui.ts                  UI half     (optional)
  daemon.ts              daemon half (optional)
  package.json
```

```jsonc
// aimux-plugin.json
{
  "id": "acme.telegram-notify",
  "name": "Telegram notify",
  "version": "0.1.0",
  "apiVersion": 1,
  "minAimuxVersion": "1.24.0",
  "entries": { "daemon": "./daemon.ts" },
  "config": {
    "botToken": { "type": "string", "required": true, "secret": true },
  },
}
```

```ts
// daemon.ts
import { type DaemonPluginContext, definePlugin } from '@brimveyn/aimux-plugin'

export default definePlugin<DaemonPluginContext>({
  apply(ctx) {
    ctx.on('tab:turnComplete', ({ tabId }) => {
      ctx.log.info('turn complete', { tabId })
    })

    ctx.effect(() => {
      const timer = setInterval(poll, 60_000)
      return () => clearInterval(timer)
    })
  },
})
```

## The one rule

**Everything a plugin registers must be reversible.** Register through
`ctx.on`, `ctx.effect`, or an API that returns a disposer, and unloading is
automatic. Reach around the context — a global, a bare `setInterval`, a
listener on someone else's emitter — and it survives the reload as a leak.

## Context

| Member                                            | What it does                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `ctx.id`, `ctx.manifest`, `ctx.host`              | identity, and which process this half runs in                    |
| `ctx.log`                                         | writes to `<state>/plugin.log`, readable via `aimux plugin log`  |
| `ctx.config`                                      | manifest schema ⊕ registry ⊕ `aimux.config.ts`, defaults applied |
| `ctx.paths`                                       | `root`, `config`, `state`, `log`                                 |
| `ctx.effect(setup)`                               | run now, dispose on unload (reverse order)                       |
| `ctx.on(event, listener)`                         | subscribe; auto-disposed                                         |
| `ctx.emit / parallel / serial / bail / waterfall` | five dispatch modes                                              |
| `ctx.rpc.call / handle / broadcast`               | talk to this plugin's other half across the process boundary     |
| `ctx.provide / ctx.service`                       | publish and read services other plugins may `inject`             |

## Testing

`createTestContext()` builds a context with the real event bus and effect
stack behind it, and stubs only what crosses a process boundary.

```ts
import { createTestContext } from '@brimveyn/aimux-plugin'
import plugin from './daemon'

test('notifies on turn complete', async () => {
  const t = createTestContext({ config: { botToken: 'x' }, onCall: () => ({ ok: true }) })
  await t.apply(plugin)

  t.bus.emit('tab:turnComplete', { tabId: 't1' })

  await t.dispose()
  expect(t.effectCount()).toBe(0)
})
```

## Author loop

```
aimux plugin new acme.thing --daemon   # scaffold
aimux plugin link ./acme-thing         # register + build, watched from now on
aimux plugin log acme.thing -f         # watch it work
aimux plugin doctor ./acme-thing       # validate manifest, dry-import, list registrations
```

Full docs: `docs/developer/plugins.md` in the aimux repository.
