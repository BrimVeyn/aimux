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

| Path                             | Holds                                             |
| -------------------------------- | ------------------------------------------------- |
| `<profile>/plugins/<id>/`        | installed plugins (checkout managed by aimux)     |
| `<profile>/plugins-config/<id>/` | files a human edits                               |
| `<profile>/plugins-state/<id>/`  | runtime state, `plugin.log`, `.hot/` build output |
| `<profile>/aimux-plugins.json`   | registry: links, enabled flags, per-plugin config |

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
