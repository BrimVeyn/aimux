---
title: Plugin Kernel
description: Architecture of the in-process plugin system — contexts, fibers, hot reload, and the API contract.
---

# Plugin Kernel

aimux loads plugins **in-process**, one half per host process, and unloads them
by running every disposer they registered. That single property — registration
is always reversible — is what makes hot reload safe by construction, and it is
the reason the API looks the way it does.

The kernel is modelled on Cordis (context, injection, reversible effects, typed
events, fibers, HMR). The distribution format is modelled on herdr (declarative
manifest, `config` / `state` directories, `install` / `link`, a shipped skill,
and a subprocess adapter so a plugin can be written in any language).

**Where the types live.** `@brimveyn/aimux-config` holds the application state,
mode, layout, action and settings shapes; `src/` re-exports them. They used to
be declared in both places, "kept structurally identical" by hand, and had
already drifted on six types by the time anyone checked. A public plugin API
cannot rest on that.

## Hosts

```
┌──────────────────────────┐   ┌──────────────────────────┐   ┌──────────────────┐
│ App UI                   │   │ Daemon                   │   │ Terminal manager │
│                          │   │                          │   │                  │
│ PluginKernel('ui')       │   │ PluginKernel('daemon')   │   │ PTY + emulators  │
│  widgets · views · modals│   │  assistants · detectors  │   │                  │
│  actions · keymaps       │   │  HTTP hooks · events     │   │ loads no plugin, │
│  settings · themes       │   │  IPC requests · CLI      │   │ by rule          │
└────────────┬─────────────┘   └────────────┬─────────────┘   └──────────────────┘
             │   IPC v19, capability        │      daemon ⇄ TM: unchanged
             └──── pluginRpc ───────────────┘
```

The terminal manager never loads plugin code. It is the process holding every
PTY, and its stability is what guarantees sessions survive a crash anywhere
else. `bun run lint:protocol` enforces the rule: nothing under
`src/terminal-manager` may import `src/plugins`.

## Anatomy

```
my-plugin/
  aimux-plugin.json      manifest — parsed without executing any code
  ui.ts                  UI half     (optional)
  daemon.ts              daemon half (optional)
  package.json           the plugin's own deps; `bun install` at link/install
```

The manifest carries everything the host must know _before_ running plugin
code: which halves exist (hence which process a change reloads), the API
generation, the config schema (hence the generated settings rows), and the
subprocess commands. See `@brimveyn/aimux-plugin`'s `PluginManifest` for the
full schema.

## Locations

All per-profile, like the sockets — the `dev` profile has its own plugins.

| Path                             | Holds                                                   |
| -------------------------------- | ------------------------------------------------------- |
| `<profile>/plugins/<id>/`        | installed plugins (checkout managed by aimux)           |
| `<profile>/plugins-config/<id>/` | files a human edits                                     |
| `<profile>/plugins-state/<id>/`  | runtime state, `plugin.log`, `.hot/` build output       |
| `<profile>/aimux-plugins.json`   | registry: links, enabled flags, per-plugin config       |
| `<profile>/themes/*.json`        | extra themes, in the shipped format; filename is the id |
| `<runtime>/plugin-cli.json`      | sidecar: the shape of every plugin CLI command          |

`aimux.config.ts` is the declarative alternative to the registry:

```ts
export default defineConfig({
  plugins: ['./local/plugin', { id: 'acme.x', enabled: false, config: { botToken: '…' } }],
})
```

## Module loading — the phase 0 decision

Three candidates were measured for reloading a changed plugin without
restarting the process.

| Approach                         | Reloads deps | Shared React | 100 cycles |
| -------------------------------- | ------------ | ------------ | ---------- |
| `import(path + '?v=' + mtime)`   | **no**       | ambient      | 8 ms       |
| `Bun.build` → file → `import()`  | yes          | **forced**   | 50 ms      |
| copy to `<state>/.hot/<hash>.ts` | no           | ambient      | —          |

The query-string trick reloads only the entry: a change to a sibling module the
entry imports is invisible, because Bun keeps the dep resolved from the first
load. That rules it out for anything but a single-file plugin.

**Decision: bundle on reload.** `src/plugins/module-loader.ts` runs
`Bun.build({ target: 'bun', format: 'esm', external: SHARED_EXTERNALS })` over
the entry, rewrites the surviving bare specifiers to absolute paths resolved
from _aimux's own_ root, writes the artifact under `<state>/<id>/.hot/`, and
imports it. Two problems fall to one mechanism:

- every transitive dependency is inlined, so any edit inside the plugin is
  picked up;
- `react`, `react/jsx-runtime`, `@opentui/react`, `@opentui/core`,
  `@brimveyn/aimux-plugin` and `@brimveyn/aimux-config` resolve to aimux's
  copies, so a plugin can never end up with a second React instance and silently
  broken hooks.

Measured at 0.5 ms per reload cycle and a flat heap across 100 cycles — two
orders of magnitude inside the 200 ms budget the plan set.

Bun emits externals with their original specifier no matter how `onResolve`
answers, so the rewrite is a post-pass over the generated ESM. It anchors on
import/export statement positions, which is safe because the only bare
specifiers left in a bundle are the ones we marked external.

## Lifecycle

Each half is a **fiber** with its own state machine:

```
PENDING ──(deps satisfied)──▶ LOADING ──▶ ACTIVE
   ▲                              │           │
   └──(dep withdrawn)─────────────┘       (apply threw)
                                              ▼
UNLOADING ──▶ DISPOSED                     FAILED
```

- `PENDING` — waiting on a service listed in `inject`.
- `LOADING` — module imported, `apply` running.
- `ACTIVE` — applied; its registrations are live.
- `FAILED` — `apply` threw. The error surfaces as a toast and in
  `aimux plugin log <id>`. Nothing else is affected.
- `UNLOADING` → `DISPOSED` — every disposer run, in reverse order. A throwing
  disposer does not stop the unwind: a half-disposed fiber is the one state
  reload cannot recover from.

## Hot reload

1. `fs.watch` (recursive, 150 ms debounce) over each linked plugin.
   `AIMUX_PLUGIN_WATCH=0` turns it off.
2. The manifest says which halves exist, so a change reloads only the affected
   processes.
3. The fiber unloads, the module is rebuilt and re-imported, a new fiber
   applies.
4. On the daemon side this touches neither the socket nor the terminal manager:
   no PTY is affected and no client reconnects.
5. `aimux plugin reload [id]` runs the same path by hand.

## The UI surface

A plugin declaring `entries.ui` receives three service objects on its context,
attached by the UI host through the kernel's `extendContext` hook. The kernel
itself stays host-agnostic — it knows how to build a context and how to dispose
one, and nothing about what either process can offer.

| Member                                              | What it registers                                   |
| --------------------------------------------------- | --------------------------------------------------- |
| `ctx.ui.widgets.register`                           | a bar widget, placed and resized like the built-ins |
| `ctx.ui.views.register` / `.open` / `.close`        | a full-screen view that replaces the pane tree      |
| `ctx.ui.modals.register` / `.open` / `.close`       | a modal, closed by the ordinary `close-modal`       |
| `ctx.ui.settings.registerSection`                   | a settings section beyond the generated one         |
| `ctx.ui.themes.register`                            | a theme, in the shipped JSON format                 |
| `ctx.ui.stats.registerPage`                         | a page on the stats screen                          |
| `ctx.ui.toast`                                      | the usual three toast levels                        |
| `ctx.ui.kit`                                        | `Panel`, `Row`, `List`, `KeyHint`, `useTheme`       |
| `ctx.actions.register` / `.effect`                  | a named keyboard action, and the effect it runs     |
| `ctx.store.reducer` / `.get` / `.set` / `.dispatch` | this plugin's slice of `AppState`                   |

Two invariants are enforced by the host rather than asked of the plugin.

**Every registration goes on the fiber.** The host wraps each one in
`ctx.effect`, so an unload is total: a plugin does not have to keep the
disposers, and could not leak one if it tried.

**Ids are namespaced by the host.** A plugin registering `board` gets
`acme.thing.board` whether it wanted to or not. Two plugins can each have a
"board", and the owner of any id stays readable from the id alone.

### Keyboard

An action is registered by unqualified verb and bound by qualified name:

```ts
ctx.actions.register('open', () => ({
  actions: [],
  effects: [{ type: 'plugin-effect', pluginId: ctx.id, effectId: 'openBoard' }],
}))
ctx.actions.effect('openBoard', () => ctx.ui.views.open('board'))
```

```ts
// aimux.config.ts
keymaps: (k) => k.mode('navigation', (m) => m.map('<leader>b', k.plugin('acme.thing.open'))),
```

A name rather than a function, because the keymap is resolved at startup and
plugins load after it — requiring an import would mean a config file could only
reference plugins it could reach. An unresolved name is inert: the key does
nothing, the way an unbound key does. Anything louder would turn one disabled
plugin into a broken keyboard.

### What "opening a closed union" meant

`AppAction`, `SideEffect`, `ModalState` and the mode tables stay closed unions —
the exhaustiveness checks across every reducer and the 68-branch effect executor
are worth more than the ability to add arms. Each grew exactly one generic
variant instead, routed by `pluginId`:

- `plugin-action` → the plugin's slice reducer;
- `plugin-effect` → the plugin's effect handler;
- `plugin-modal` → the plugin's modal renderer;
- `plugin-view` (a `FocusMode`) → the plugin's view renderer.

`ModeId` is the exception: it becomes ``BuiltinModeId | `plugin.${string}` ``,
because a mode is an identity rather than a payload. Three tables that were
exhaustive over it — the transition matrix, the focus-mode derivation, the help
headings — each gained a registry with a disposer.

### Orphans

A persisted layout can name a widget whose plugin is disabled, still loading, or
failed. That id used to be pruned as corruption and the pruned layout written
back to `aimux.json`, so re-enabling the plugin put the widget somewhere else —
or nowhere. The layout now keeps the id and `visibleWidgets` skips what cannot
be drawn, so a bar reserves no space for it and the context menu does not offer
it.

## The daemon surface

A plugin declaring `entries.daemon` receives its services through the same
`extendContext` hook, with the same two invariants — every registration on the
fiber, every id namespaced by the host.

| Member                            | What it does                                             |
| --------------------------------- | -------------------------------------------------------- |
| `ctx.tabs`                        | list, get, `spawn`, `send`, `focus`, `close`, `snapshot` |
| `ctx.projects` / `ctx.workspaces` | read the catalog, fresh on every call                    |
| `ctx.assistants.register`         | a complete assistant, in one object                      |
| `ctx.hooks.route` / `.url`        | an HTTP hook route at `/hook/<pluginId>.<id>`            |
| `ctx.cli.register`                | an `aimux <group> <verb>`                                |
| `ctx.on('tab:turnComplete')`, …   | the daemon event bus                                     |

### Events

| Event                                                   | Fires when                                            |
| ------------------------------------------------------- | ----------------------------------------------------- |
| `tab:status`                                            | a tab's activity changed — the finest and noisiest    |
| `tab:turnComplete`                                      | `idle` held for the settle window; once per turn      |
| `tab:question`                                          | a tab is blocked on a question or a permission prompt |
| `tab:added`                                             | a tab was created, by the UI or a headless CLI        |
| `project:status` / `:created` / `:switched` / `:closed` | project lifecycle                                     |
| `workspace:added` / `:removed`                          | workspace lifecycle                                   |
| `daemon:reexec`                                         | the daemon is handing off; one chance to flush        |

Every one already existed as an IPC broadcast — the daemon knows a turn ended
precisely because it is about to tell the UI. They fire _before_ the socket
write, so a plugin reacting to a turn does not queue behind one.

### Assistants

An assistant is not one thing: a spawn command, a way of reading its TUI to
tell working from waiting, a way of parsing the choices in a blocked prompt,
optionally a usage endpoint, optionally a hook stream. A plugin declares them
together because from the outside they are one thing — a tab that spawns and
then never reports a status is a half-integration, not a feature.

```ts
ctx.assistants.register({
  option: { id: 'acme.robot', label: 'Acme robot', command: 'acme-robot', description: '…' },
  detectStatus: ({ haystack }) => (haystack.includes('whirring') ? 'working' : null),
  extractOptions: ({ lines }) => parseMyMenu(lines),
  usage: async (config) => fetchMyQuota(config),
  hooks: { urlEnvVar: 'ACME_HOOK_URL', mapEvent: (name) => (name === 'TurnEnded' ? 'idle' : null) },
})
```

`null` from a classifier is "no opinion" and hands over to the generic
quiet-screen heuristic — the same contract the built-ins have. A hook event
outranks the visual reading while fresh, except that a _visible_ permission
prompt always wins: some prompts fire no hook at all, and the screen is the
only place they show.

Unregistering does not close the tabs already running the assistant. A PTY
outlives the plugin that described how to spawn it.

### CLI commands

A plugin's command runs in the daemon; the CLI process loads no plugin code.
The daemon writes the command's _shape_ to `<runtime>/plugin-cli.json`, and the
CLI reads that to parse, validate and complete the call — so a usage error is
reported at the same speed and in the same shape as for a built-in verb, and
`aimux __complete` never opens a socket.

## Commands, without any TypeScript

A manifest's `commands[]` need no `entries` at all. Each is an argv the daemon
spawns, and the plugin talks back through the `aimux` CLI it already has — no
SDK, no bindings, nothing to keep in sync per language. A shell script is a
plugin.

```jsonc
{
  "id": "acme.notify",
  "version": "0.1.0",
  "apiVersion": 1,
  "commands": [{ "id": "ping", "title": "Ping", "command": ["./notify.sh"] }],
}
```

```
aimux plugin commands              # list what every manifest declares
aimux plugin exec acme.notify ping # run one
```

The environment a command is spawned with:

| Variable                                           | Why                                                 |
| -------------------------------------------------- | --------------------------------------------------- |
| `AIMUX_BIN_PATH`, `AIMUX_SOCKET_PATH`              | call back with `aimux tab send`, `aimux worker run` |
| `AIMUX_PLUGIN_ID`                                  | who you are                                         |
| `AIMUX_PLUGIN_ROOT` / `_CONFIG_DIR` / `_STATE_DIR` | your directories, already resolved                  |
| `AIMUX_CONTEXT_JSON`                               | what triggered this, as JSON                        |
| `AIMUX_ENV=1`                                      | a marker to test for, like `CI`                     |

Spawned with argv, never through a shell: no quoting to get wrong, nothing to
inject into. `cwd` is the plugin's directory, which is what a relative
`./notify.sh` means. A non-zero exit is the command's answer and
`aimux plugin exec` passes it through as its own.

## API contract

`apiVersion: 1` is frozen as of this document. Within generation 1:

- nothing already exported from `@brimveyn/aimux-plugin` is removed or changes
  meaning;
- new services arrive as new optional members reached through `inject`, so a
  plugin that asks for one it does not get stays `PENDING` rather than
  crashing;
- anything not yet exercised by a built-in plugin is marked `@experimental` and
  may still move. Dogfooding is the promotion gate.

Every context API returns a disposer or is registered through `ctx.effect`.
That is the invariant the whole system rests on.

## Security

Plugin code runs with the user's privileges — same posture as herdr, and there
is no sandbox. `aimux plugin install` prints the manifest and waits for
confirmation before cloning and running `build`; `--yes` is the explicit
opt-out. Moving the daemon half into a Bun `Worker` is a phase 5 option; the
RPC API is shaped so that move would be invisible to plugins.
