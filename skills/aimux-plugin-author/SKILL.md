---
name: aimux-plugin-author
description: Write, test and ship an aimux plugin — widgets, views, modals, keybindings, settings, themes, assistants, HTTP hooks, CLI verbs and subprocess commands — through the @brimveyn/aimux-plugin API. Use when asked to extend aimux with a plugin, to debug one that will not load, or to decide which half of aimux a feature belongs in.
---

# aimux plugin author

An aimux plugin is a directory with a manifest and up to two halves. The UI
half runs in the process drawing the screen; the daemon half runs in the
process owning the PTYs and keeps running when no UI is attached. The terminal
manager — the process holding the actual terminals — loads no plugin code at
all, which is why a broken plugin cannot cost anyone a session.

Everything a plugin registers is reversible, and the host, not the plugin,
holds the disposers. That is the property the whole design rests on: unloading
is total by construction, so `link`, edit, save, reload is a loop rather than a
restart.

## Preflight

```bash
aimux plugin doctor --help     # confirm this aimux has the plugin kernel
aimux plugin list              # what is already loaded, and from where
```

If `plugin` is not a known group, this aimux predates the plugin kernel — say
so and stop rather than writing against an API that is not there.

## The loop

```bash
aimux plugin new acme.thing --ui --daemon   # a plugin that already works
cd acme.thing && bun install
aimux plugin link .                          # register it, watched for edits
aimux plugin doctor .                        # manifest, both halves, types
aimux plugin log acme.thing                  # what it has been saying
```

Then edit and save. A linked plugin reloads in place; `aimux plugin reload
acme.thing` forces it. `aimux plugin doctor .` is the command to run after
every meaningful change — it validates the manifest, imports each half, applies
it against a sandbox context, and lists what that `apply` registered. A field
name and a reason come back, not "invalid manifest".

Do not read the plugin's own source to find out what it registers. Run doctor;
its `registrations` block is the answer, and it is the answer _aimux_ has.

## Choosing a half

| The feature…                                         | Half     |
| ---------------------------------------------------- | -------- |
| draws something, or reacts to a key                  | `ui`     |
| must keep working with no UI attached                | `daemon` |
| reacts to what an agent did (`tab:turnComplete`)     | `daemon` |
| spawns, writes to, or closes tabs                    | `daemon` |
| serves an HTTP hook, or adds an `aimux <group>` verb | `daemon` |
| needs both                                           | both     |

Two halves of one plugin talk over `ctx.rpc` — `call` for an answer, `broadcast`
for a fact. They never share memory: they are different processes.

## Rules that are not style

**Everything goes on the fiber.** Every `register` returns a disposer and has
already been recorded; `ctx.on`, `ctx.provide` and `ctx.rpc.handle` likewise.
For anything else with a lifetime — a timer, a socket, a watcher — use
`ctx.effect(() => { ...; return () => cleanup() })`. A plugin that keeps a
module-level `setInterval` survives its own unload, and that is the one bug
this design cannot forgive.

**No module-level state.** A reload imports a fresh module; anything held
outside `apply` is either lost or leaked. Keep state in closures inside
`apply`, in `ctx.store` (UI), or on disk under `ctx.paths.state`.

**Ids are namespaced by the host.** Register `board` and it becomes
`acme.thing.board` everywhere — the keymap, the config, the widget list. Never
prefix them yourself, and never assume an unqualified id.

**Never touch the IPC protocol.** `ctx.rpc` is the whole cross-process story. A
plugin that reaches for a socket or a protocol version is doing something the
kernel already does correctly.

**Config comes from the manifest.** Declare fields under `config` and read
`ctx.config`. That generates the settings rows and gives every value a type; a
plugin parsing its own JSON is a plugin whose settings screen is empty.

## Writing the tests

`createTestContext()` is the same context with nothing behind it: the same
event bus, the same effect stack, recorded services instead of a running aimux.
So a plugin test needs no aimux, and the test that matters is the same one
every time:

```ts
const harness = createTestContext({ host: 'daemon', id: 'acme.thing' })
await harness.apply(plugin)
// …assert on what it did…
await harness.dispose()
expect(harness.effectCount()).toBe(0) // an unload leaves nothing behind
```

## References

- `references/api.md` — every export of `@brimveyn/aimux-plugin`, generated
  from the sources. Read it rather than guessing a signature.
- `references/recipes.md` — one short recipe per surface: widget, view, modal,
  keybinding, settings, theme, stats page, status bar, assistant, hook route,
  CLI verb, subprocess command.
- `references/manifest.md` — the manifest schema, with the mistakes that make
  it invalid.

## Before you say it is done

- `aimux plugin doctor .` — `ok: true`, and the `registrations` it reports are
  the ones you meant to make.
- `bun test` in the plugin — including the dispose assertion above.
- `README.md` — what it does, what it configures, which halves it ships.
- The manifest's `description` and `config` descriptions are written for
  someone who has not read the code; they are what the settings screen shows.
