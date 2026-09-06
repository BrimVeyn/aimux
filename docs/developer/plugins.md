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
generation, the config schema (hence the generated settings rows), the
subprocess commands, and what the plugin asks the interface for. See
`@brimveyn/aimux-plugin`'s `PluginManifest` for the full schema.

## Contributions — placement and keys

Registering a widget makes it _drawable_; it does not put it anywhere. Bars
draw what `aimux.json` lists, and the same asymmetry applies to actions: a
registered action is bound to nothing until a keymap names it. Left there, a
plugin that loaded perfectly is a plugin nobody can see or reach, and the fix
was a hand-edited config file plus a restart.

`contributes` closes that. The host applies it while it extends the plugin's
context — before the plugin's own `apply`, which is harmless in both
directions: a placed widget whose renderer is not registered yet is an orphan,
and bars already skip those; a bound key resolves its action at press time.

```jsonc
"contributes": {
  "bars": [{ "widget": "load", "side": "left" }],
  "keymaps": [{ "id": "up", "description": "Shift model up", "mode": "navigation", "key": "<leader>+", "action": "up" }],
}
```

**Placement** dispatches `add-widget` with `placedBy: 'plugin'`. That mark is
the whole design: `remove-plugin-widget` withdraws only what carries it, and
`move-widget` and `toggle-widget` strip it — the moment the user arranges the
widget, the placement is theirs and neither a reload nor an unload touches it.
`add-widget` is also idempotent, because a plugin re-applies its manifest on
every reload.

**Keys** go through `registerKeymapLayer` (`src/input/keymap/plugin-layer.ts`),
which inserts into the _live_ trie of the mode's existing handler rather than
rebuilding it. Rebuilding would hand `app.tsx` a stale handler — the one its
timeout and pending-chord callbacks are wired to, and the one the
terminal-input fast path holds. Removal is symmetric and identity-checked: a
key rebound in the meantime is not the layer's to take back.

A binding the user already owns is **refused**, with the reason in the plugin's
log. A mode nobody has bound — a plugin pane's own mode — gets a handler built
and registered for it, wired through `setKeymapHandlerWiring` so it gets the
same callbacks `registerAllModes` handed the others.

## Two smaller holes the examples found

**A plugin could not move the user.** `ctx.ui.navigate('git' | 'stats' |
'settings' | 'terminal')` covers the real need without exposing modal or view
ids, which would become API the day they were exposed. It leaves the current
screen before opening another, the way a key press does.

**A widget knew its width and guessed its height.** `render` now receives
`(contentWidth, { cols, rows })`. A second argument rather than a replacement:
the width shipped as a number under `apiVersion: 1`, and swapping it would
break every published plugin to save a parameter. `rows` is _measured_ after
opentui settles layout — the height is a flex share, so recomputing it here
would be a second implementation of someone else's arithmetic, correct until it
was not.

## `tab:prompt`, and why it took a refactor

A plugin that reacts to what the user asked wants the prompt. Reconstructing it
from keystrokes already existed — inside `AutoRenameCoordinator`, behind that
feature's rule: watch a tab until it has a title, then stop. Right for
auto-rename, and wrong for an event. Emitted from there, `tab:prompt` would
have fired for a tab's first prompts and then gone silent forever, with nothing
in the payload saying so.

So observation moved out to `src/prompts/prompt-observer.ts`, which watches
every tab, and auto-rename became one subscriber among others — its eligibility
check now sits next to the decision it guards.

```ts
ctx.on('tab:prompt', ({ tabId, projectId, prompt, source }) => { … })
```

`source` is `hook` (ground truth from a provider's `UserPromptSubmit`) or
`keystrokes` (reconstructed from PTY bytes, the fallback for assistants with no
hook). Once a hook has spoken for a tab, its keystrokes are ignored — the same
submission would otherwise arrive twice, once right and once approximately. A
reconstruction the observer cannot trust (history recall, tab completion,
unknown escapes) is dropped: a missing event is possible, a wrong one should
not be.

## Git: a slot, not a subsystem

Git mode is not a point of extension — it is the application: a screen, a diff
renderer, a command queue, a PR panel, ~40 files. Turning it into a plugin
would make the plugin API aimux's internal API, which is the one thing
`apiVersion: 1` promises not to be.

What is worth opening is the single decision inside it with no right answer:
the words of the commit.

```ts
ctx.ui.git.provideCommitMessage(async (request, signal) => {
  // request: { projectId, repoRoot, branch, diff, recentCommits, files, sessionTail? }
  return { title: 'feat: …', body: '…' } // or null to decline
})
```

aimux keeps the trigger, the working-tree hash, the abort and the panel; the
plugin answers one question. Three rules make it safe to hand over:

- **One slot, first registration wins.** A message that depends on load order
  is worse than no message, so the second plugin is refused and told why in its
  own log.
- **Declining is not failing.** `null` — or a throw, which is logged against
  the plugin — falls back to aimux's own suggestion rather than leaving the
  user with nothing.
- **A provider replaces the headless model call, including its prerequisites.**
  With one registered, auto-commit no longer refuses because `claude` is
  missing from PATH: a machine without it is exactly where a plugin writing
  commit messages is most useful.

Alongside it, two read-only pieces for anything that reacts to the repository:

- `ctx.ui.git.status()` — the panel's last refresh, narrowed to
  `{ branch, ahead, behind, files }`. A snapshot of aimux's poll, not a fresh
  `git status`: it is what the user is looking at, and it is empty until a
  project with a path is open.
- `git:workingTreeChanged` — emitted only when the tree actually moved. The
  poll runs every few seconds; a plugin woken on every tick is a plugin nobody
  keeps installed, so the decision uses the same working-tree hash auto-commit
  uses to know its suggestion went stale.

The UI's own events reach plugins through `src/ui/plugin-events-ref.ts`: the
host publishes one emitter, and a call site emits without importing the kernel
— the same shape as `dispatchGlobal`. The daemon needs no such thing, because
everything it emits already passes through one place.

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
| `ctx.ui.themes.current` / `.onChange`               | the active palette and mode, outside React          |
| `ctx.ui.settings.get` / `.watch`                    | one of aimux's own setting rows, by dotted id       |
| `ctx.ui.statusBar.register`                         | a tile on the right of the status bar               |
| `ctx.ui.panes.register` / `.open` / `.close`        | a leaf in the layout tree that is not a terminal    |
| `ctx.ui.state.get` / `.subscribe` / `.use`          | tabs, the active tab, the project — read only       |
| `ctx.ui.stats.registerPage`                         | a page on the stats screen                          |
| `ctx.ui.toast`                                      | the usual three toast levels                        |
| `ctx.ui.kit`                                        | `Panel`, `Row`, `List`, `KeyHint`, `useTheme`       |
| `ctx.actions.register` / `.effect`                  | a named keyboard action, and the effect it runs     |
| `ctx.store.reducer` / `.get` / `.use` / `.dispatch` | this plugin's slice of `AppState`                   |

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

### Panes

A widget is a narrow strip and a view takes the whole screen. A pane is the one
in between, and the one the layout tree was already shaped for: a board, a
diff, a log browser sitting _beside_ an agent rather than covering it.

`LayoutLeaf` gained `kind?: 'tab' | 'plugin'`. Absent means `tab`, which is
every layout ever written to `aimux.json`, so nothing migrated. The interesting
consequence is that `allLeafIds` had to go: every caller of it meant "the
terminals in this group" — it indexed into `state.tabs`, resized a PTY, or
ordered the tab strip — and quietly widening it would have handed a plugin pane
id to `backend.resizeTab`. It split into `allTabIds` and `allPaneIds`, and the
compiler made all twelve call sites answer which they meant.

Geometry says panes, everything else says tabs: `computePaneRects` covers every
leaf, because a plugin pane takes up space and leaving it out would size the
terminal beside it wrong; `forEachSplitPaneRect` computes over the whole tree
and hands back only tabs, because its caller's next move is to resize a PTY.

**A pane holds the keyboard without holding `activeTabId`.** That field stays a
tab id in every reducer and every side effect in the app — widening it would
mean auditing all of them for "what if this is not a tab" — so
`state.activePluginPaneId` names the focused pane alongside it, and the
terminal keeps being named. Navigating onto a pane sets it; making any tab
active clears it, which is why the clear lives in `withActiveTabWorkspace`
rather than at every call site.

Registering a pane installs a mode for it the way a full-screen view does: the
mode, its help heading, and the derivation that routes input to it. The id is
`plugin.pane.<paneId>` rather than `plugin.<paneId>`, because a plugin may
register a view and a pane under the same unqualified name and two modes with
one id would send the second one's keys to the first.

`getAdjacentPane` is the traversal navigation uses — any leaf is a
destination. `getAdjacentLeaf` is the tab-only one, for the callers that need
somewhere to put `activeTabId`: closing a tab, mainly, where a plugin pane is
not an answer.

**Panes are session-scoped.** Saving strips them: a group holding one terminal
and one plugin pane is not a split worth writing, because the plugin may be
disabled or gone by the next launch. The restore path already pruned anything
that was not a live tab; `stripPluginPanes` is about not writing the id at all.

**One instance per id.** Opening an open pane is a no-op rather than a second
copy — the id is the plugin's name for it, and two panes claiming it would make
`close` ambiguous. A pane whose plugin is not loaded renders a line naming it,
because an unexplained empty rectangle in a layout is worse.

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

### Metrics

`ctx.metrics.counters(days)` hands over aimux's own record of its use, per
local calendar day. Counts and nothing else — no key identity, no content —
which is the posture the counters file already had and the reason exposing it
needed no new decision.

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

## Built-in plugins

Some of aimux's own features are plugins. `src/builtin-plugins/` holds them,
and `builtinPlugins(resolvedConfig)` is the list both hosts are handed.

A built-in is not a privileged kind of plugin. Same record, same fiber, same
context, same effect stack, same reload, same config precedence, same
`plugin list` row. It differs in one place — where the definition comes from —
and that is four lines in the fiber:

```ts
const builtin = this.record.builtin?.[this.host]
if (builtin) definition = await builtin()
else <bundle and import from disk>
```

There is no directory and no manifest file, because there is no disk: aimux
compiles to a single binary. The manifest is a literal validated by the same
`parseManifest` a third-party one goes through, so a malformed built-in
manifest fails in CI rather than in a terminal. The halves are lazy imports, so
the daemon never evaluates a UI half.

A built-in has no registry row to toggle; it is switched off from
`aimux.config.ts` with `plugins: [{ id, enabled: false }]`, and
`aimux plugin disable` says so rather than claiming it is not installed.

### Migrated config

A migrated feature usually predates its plugin, and the keys it was configured
under are already in people's config files. `BuiltinPlugin.config` seeds
`ctx.config` from aimux's own configuration, so the plugin body reads nothing
but `ctx.config` — exactly like a third-party plugin — while the mapping from
the legacy key stays visible in the built-in's declaration:

```ts
export function aiUsagePlugin(config?: ResolvedConfig): BuiltinPlugin {
  const aiUsage = config?.statusBar?.aiUsage
  return {
    config: { claudePlan: aiUsage?.claudePlan },
    defaultEnabled: false,
    enabled: aiUsage?.enabled,
    halves: { … },
    manifest: { … },
  }
}
```

`enabled` seeds the same way, for the one value that is not configuration but
existence, and ranks with `plugins: [{ id, enabled }]` — same file, same hand.
`defaultEnabled` is the bottom of that stack: `true` for everything aimux simply
does, `false` for a feature that reads credentials or talks to the network,
which has to be asked for rather than arrived at.

Settings _rows_ need none of that: `ctx.ui.settings.get`/`watch` read aimux's
own rows by the dotted id the user writes, so a feature can move into a plugin
while its settings stay exactly where they were — every row except the one that
said whether the feature is on. That one is the plugin's own switch now: two
switches for one feature is a feature you can turn on and watch do nothing.
A row this screen wrote and no longer reads is carried to its new home by
`src/plugins/migrations.ts`, which both hosts run before they read the registry.

### What the migrations changed about the API

Each migration was a test of the API, and what it could not express cleanly was
filled in before it landed.

| Migration                                 | What was missing                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `aimux.claude` (theme sync, hook install) | reading the active theme outside React, and reading aimux's own settings rows |
| `aimux.ai-usage` (quota tile)             | a status-bar registry, seeding `ctx.config` and `enabled` from aimux's config |
| `aimux.auto-rename` (naming tabs)         | `ctx.tabs.rename`, `tab:prompt`, `tab:renamed`, `tab:closed`, and `unnamed`   |

### `auto-rename`, and what the migration cost

The one that proves the _daemon_ API rather than the UI one: it reacts to an
event, decides, calls a model, and writes a tab's title, with no privileged
access to any of the three. What stayed in aimux is what a tab _is_ — its
title, and whether anyone has named it. What moved is every decision about what
to call it: when to ask, what counts as a title-worthy prompt, how long to wait
for more, which model, how many retries, and the local fallback.

It needed four things, and none of them is auto-rename's:

- `ctx.tabs.rename` — a title that reaches the manager, the session and every
  UI. What any plugin needs to name anything.
- `tab:prompt` — what the user actually asked. Its own refactor; see above.
- `tab:renamed` and `tab:closed` — a namer must stop when someone else names
  the tab, and drop what it holds when the tab goes.
- `PluginTabView.unnamed` — "does this tab still carry the title it was born
  with". aimux's own `autoRenameStatus` under a name that describes the tab
  rather than the feature: it is set at creation, cleared by any rename, and
  it is what stops two namers fighting over one tab.

`autoRenameStatus` itself stayed exactly where it was — in the tab entry, on
the IPC and terminal-manager protocols, in the persisted session. Moving it
into the plugin would have been a protocol migration wearing a plugin
migration's clothes.

### `auto-commit`, and what was left behind on purpose

Everything that makes auto-commit a _feature_ stayed: when it triggers, the
working-tree hash that says a suggestion has gone stale, the abort that
supersedes an in-flight generation, and the panel it appears in. Moving those
would have meant moving state into a plugin slice and the UI into a plugin
view — a bigger change than the migration, and one that would have made the git
pane worse before it made it better.

What moved is the model call: the briefing template, the prompt composition,
the headless invocation, the parsing. `aimux.auto-commit` holds the
commit-message slot through the same `ctx.ui.git.provideCommitMessage` a
third-party plugin uses, with no privileged path — the only way the slot could
be trusted, since a built-in that cheated would prove nothing about it.

That forced one rule into the slot itself: **ranks**. A built-in registered at
boot wins a first-come-first-served slot every time, so no plugin a user
installed could ever hold it. A user's plugin now displaces the built-in and
hands it back on unload; two user plugins is still a refusal, because between
equals the message you get would depend on load order.

The driver lost its own model call in the trade: there is no second path any
more, and a provider that declines means no suggestion this time rather than a
fallback to something aimux keeps in reserve.

### Not migrated, and why

- **The `setup` widget** is addressable by id in a user's `bars` config. A
  plugin's ids are namespaced by the host, on purpose, so migrating it would
  rename `setup` to `aimux.setup.setup` and silently drop it out of existing
  layouts. Worth doing with a compatibility alias, not worth doing quietly.

One limit found and left alone: a plugin can open its own modals, not aimux's.
`aimux.ai-usage`'s tile dispatches `open-quotas-modal` directly, which a
third-party plugin could not do. An API for opening built-in modals by id would
be a wide, brittle surface, and no third-party plugin has asked for it.

## The control surface

Where a user's decisions about a plugin live, and how they reach it.

`<profile>/aimux-plugins.json` has two blocks answering two questions.
`plugins[]` says _where the code is_, and only a linked or installed plugin has
a row there. `overrides` says _how the user has set it_, keyed by id — so a
built-in, a link, an install and a plugin declared inline in `aimux.config.ts`
are toggled and configured the same way. Before that split, a built-in had no
row to toggle and `plugin disable` had to apologise and point at the config
file.

The full ladder, lowest first:

```
manifest default → BuiltinPlugin.config → registry row → overrides
                 → aimux.config.ts
```

A registry row's own `enabled` and `config` are still read, so files written
before this keep working; nothing writes them any more. `PluginRecord.enabledFrom`
names the layer that decided, because a `plugin disable` that `aimux.config.ts`
will overrule at the next launch is not a disable, and an agent has to be able
to find that out before acting rather than after.

`src/plugins/config-origin.ts` answers the same question per key, once, for
both surfaces. Two copies would drift the first time a layer moved, and the CLI
and the settings screen would then disagree about the same value in front of
the same user.

### How a write lands

`ctx.config` is `record.config`, captured when `apply` ran, and `apiVersion: 1`
gives a plugin no way to hear that it changed — plugins destructure it. So a
changed value reaches a running plugin the only honest way available: the fiber
is disposed and rebuilt around the new record. `recordChanged` in the kernel
decides, covering root, version and config; an unchanged config rebuilds
nothing, which matters because `refresh` runs on every registry change and
every watcher event.

Settings writes are debounced 300 ms before that refresh, because `←`/`→` on a
number row writes once per keypress.

### The settings surface

`storage: 'plugin'` is a third row kind. Not `'settings'` — that block of
`aimux.json` is never read by discovery, so a value written there would reach
no plugin at all. Not `'app'` either: the value has no home in `AppState`, and
the two marks a plugin row needs come from the plugin's own layers rather than
from hydration, which runs once at boot before any plugin has loaded.

The row carries its own `read`/`write`/`reset` closures so the settings store
never learns how to reach a plugin registry, and the redaction lives in the
_reader_ — so the row's value, the footer's full-value line and the edit
modal's seed are covered by one rule instead of three.

`src/plugins/plugin-store.ts` is what lets a section see any of this: a
`SettingSection`'s `rows` is a plain function of the projects, deliberately, so
it has no way to reach the running host.

## Phase 9 — hosting a library

Measured against herdr's 954 public plugins rather than designed from taste:
the API was already richer than herdr's, and what was missing was three
surfaces that carry most of the catalogue. Each is below with the decision it
implements.

### A pane that runs a program

`ctx.ui.panes.registerCommand({ id, title, command: argv, cwd? })`, or the
same block as `panes[]` in the manifest with no TypeScript. Opening one spawns
a real terminal tab aimux owns for the plugin, marked `TabSession.pluginPane`,
so the whole lifecycle question is answered by that one mark:

- **Reload** re-registers the same id and `open` finds the tab already there;
  the program never notices the plugin restarted.
- **Unlink, uninstall, disable** take the record away and
  `reconcileCommandPanes` closes every tab carrying the plugin's prefix —
  program included. Declared panes are registered from the _record_ by the UI
  host, not from a fiber, which is what lets a manifest-only plugin have them
  and what ties their life to the record rather than to a reload.
- **The program exits** and the tab stays with its last frame and a line
  saying so, the same choice the setup runner makes: the output is what the
  user needs to read. `Ctrl+r` restarts it.

The spawn goes through a host-owned `plugin-effect` (`aimux` is not a legal
plugin id, so the host can own effects under it), which is why it runs in the
side-effect executor with a real context rather than reaching for the backend
from a service. Command panes are session-scoped like React panes: never
persisted, and not on the wire — after a UI restart against a live daemon they
come back as plain terminal tabs running the same argv.

### The layout as an API

`ctx.ui.layout` — `split`, `focus`, `swap`, `resize`, `close`, `tree`,
`panes` — dispatches the same actions the keys do, so a plugin cannot make a
layout the user could not have made by hand. `swap` was the one verb the
keyboard lacked; it gained a `swap-pane` action, `swapLeaves` in the tree, and
a `swapPane(direction)` factory for keymaps. Exchanging _leaves_ rather than
ids was a test-found bug: a plugin pane swapped by id alone became a
terminal. Zoom, move-into-a-slot and `apply(tree)` were left out: the first
needs a rendering mode the app does not have, the other two are `swap` and
`split` in a loop.

`ctx.workspaces.create` / `remove` reuse the CLI's core through a
`WorkspaceRegistrar` interface — the CLI hands the daemon over a socket, the
daemon hands itself — so a plugin and `aimux workspace create` cannot produce
two kinds of workspace. The request handlers and the plugin services now share
one `recordWorkspaceAdded` / `recordWorkspaceRemoved` pair in the daemon.

### Enumerable commands

`actions.register(verb, handler, { title, description })` keeps its metadata
in the action registry, and `ctx.commands.list()` folds three sources that
never knew about each other into one list — actions, manifest `commands[]`
(from the published records), CLI verbs (from the sidecar). `aimux action
list` is the same list from outside. A palette written by a third party is
now a `List` over it and `ctx.commands.run(id)`.

### Services and the event stream

`services[]` is the daemon's other process shape: `commands[]` is an argv with
a timeout, a relay or a watcher is not a command that finishes.
`ServiceSupervisor` follows _records_ through the runtime's new
`onRecordsChange` — a plugin with `services[]` and no `entries.daemon` never
gets a fiber and still gets its process — restarts per policy with a doubling
backoff capped at thirty seconds, pipes output to the plugin's log, and kills
with SIGTERM then SIGKILL when the plugin goes. Same `AIMUX_*` environment as
a command.

`aimux events follow` is `daemon/plugin-host.ts`'s event list, out of the
process as NDJSON. The subscription is a control verb answered in `daemon.ts`
rather than in the host, because only the socket layer knows which connection
asked; the fanout reuses the `pluginEvent` message under the control id, so
the wire protocol did not change. It deliberately reaches thin attachers,
which `broadcastPluginEvent` never does.

### Notifications

`ctx.ui.notifications.notify` and `provide(sink)`, on the commit-message
model: one sink, the second refused and told in its log, and while a sink
holds the slot the native sound does not play. `workspace-activity.ts` raises
its two events through `ui/notifications.ts` instead of playing the sound
itself, which is the one place the "replace, never double" rule is enforced.
UI-side only: the sound lives there, and a daemon plugin already has
`tab:turnComplete` to push from.

### Session and usage

`ctx.assistants.session(tabId)` parses the id and the model out of the argv
the daemon already keeps, rather than adding a field to the registry — a tab
created by any client on any protocol version answers the same way. The
transcript path is found by globbing the uuid under `~/.claude/projects`, as
`hasConversation` does. `usage(tabId)` reads the transcript with the rollup's
line filter and de-duplication rule but cumulative rather than per day.
`resume(tabId)` closes and respawns with the vendor's resume args, in the
workspace's directory when it had one.

### Git in writing

`diff`, `stage`, `unstage`, `discard`, `commit` in `git/plugin-git-writes.ts`,
argv only, through the same queue git mode uses so two panes cannot race on
the index lock. `discard` decides tracked-or-not from `git ls-files` rather
than from the panel, so a plugin acting on its own listing is not at the mercy
of the poll interval.

### Distribution

The index is the GitHub topic `aimux-plugin`; `plugin search` is the marketplace
page and `plugin update` re-fetches from the recorded `origin`. `install` was
split into `fetchPluginFromGitHub` and `placeInstalledPlugin` so `update` is
the same two steps with a version comparison between them.

### Left out, on purpose

The daemon half in a `Worker` (phase 5's isolation item) — a supervised
service reduces its urgency without removing it. A clock in the daemon: a
service with its own `setInterval` is the routines family. Zoom and
`layout.apply`, above. A daemon-side `notifications` API.

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

## Configurable keymaps

Each `contributes.keymaps` entry may declare a stable `id` and a human-facing
`description`. IDs are unique per plugin and key both registry and
`aimux.config.ts` overrides. Resolution follows the config ladder: manifest,
registry override, then hand-written config. A resolved `null` is not inserted
into the live trie; changing the registry rebuilds the owning fiber.

## Security

Plugin code runs with the user's privileges — same posture as herdr, and there
is no sandbox. `aimux plugin install` prints the manifest and waits for
confirmation before cloning and running `build`; `--yes` is the explicit
opt-out. Moving the daemon half into a Bun `Worker` is a phase 5 option; the
RPC API is shaped so that move would be invisible to plugins.
