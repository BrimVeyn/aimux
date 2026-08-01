---
title: Config Reference
description: Exhaustive reference for the @brimveyn/aimux-config surface.
---

# `@brimveyn/aimux-config` Reference

This is the exhaustive reference for the public configuration surface used by
`aimux`.

## Entry Points

Package name:

```ts
@brimveyn/aimux-config
```

Primary exports:

- `defineConfig`
- `actions`
- `themes`, `THEMES`, `THEME_IDS`
- `GroupBuilder`, `KeymapBuilder`, `ModeBindingBuilder`
- `getDefaultKeymapConfig`
- `resolveConfig`
- public types for config, state, and tooling

Additional export:

```ts
@brimveyn/aimux-config/backends
```

## Top-level Config Object

```ts
defineConfig({
  theme?: {
    initialMode?: 'light' | 'dark'
    paletteOverrides?: Partial<AimuxPalette>
  }
  keymaps?: (k: KeymapBuilderApi) => KeymapBuilderApi
  backends?: Record<string, BackendConfig>
  sidebar?: SidebarConfig
  projectBar?: ProjectBarConfig
  gitPane?: GitPaneConfig
  hooks?: HooksConfig
  snippets?: SnippetDef[]
  snippetTriggerChar?: string
  autoCommit?: Partial<AutoCommitConfig>
  autoRename?: Partial<AutoRenameConfig>
  multiRepo?: Partial<MultiRepoConfig>
  statusBar?: StatusBarConfig
})
```

## Support Matrix

Most of these fields also have a row in the in-app settings screen (`<Leader>,`),
which writes to `aimux.json`. This file is read at every launch and wins over it:
a field declared here comes back on the next start, and the row says so. See
`../guide/settings.md`.

| Field                | Status             | Notes                                                                                                                   |
| -------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `keymaps`            | Supported          | Fully resolved and registered by the app                                                                                |
| `projectBar`         | Supported          | Startup overrides; if set, these values reapply on every launch and beat `aimux.json`                                   |
| `gitPane`            | Supported          | Content prefs only; placement moved to the app-managed `bars` state                                                     |
| `theme`              | Supported          | `theme.initialMode` is a startup override; persisted `aimux.json.themeId` still wins                                    |
| `backends`           | Typed surface only | Resolved by the config package, but current runtime wiring is deferred                                                  |
| `sidebar`            | Ignored            | Superseded by the app-managed `bars` state; kept so old config files still typecheck                                    |
| `hooks`              | Typed surface only | Type exists; runtime use is not currently wired                                                                         |
| `snippets`           | Supported          | Config-pinned snippets are merged into the runtime catalog at boot; read-only in the picker. See `../guide/snippets.md` |
| `snippetTriggerChar` | Supported          | Single-character prefix for inline snippet triggers (default `:`). See `../guide/snippets.md`                           |
| `autoCommit`         | Supported          | AI-written commit messages. Disabled by default; see `../guide/git-mode.md#auto-commit`                                 |
| `autoRename`         | Supported          | Renames new assistant tabs from their first prompt. Enabled by default; see `../guide/projects.md#automatic-tab-names`  |
| `multiRepo`          | Supported          | Aggregates nested sub-repos into one git panel. Enabled by default; see `../guide/git-mode.md#multi-repo-projects`      |
| `statusBar`          | Supported          | Hosts the `aiUsage` sub-block (AI usage indicator) and the `separator` glyph style for the bottom status bar            |
| `workspaceTemplates` | Removed            | Superseded by the per-project setup script. See `../guide/workspaces.md#setup-script`                                   |

## `defineConfig`

`defineConfig(config)` is the authoring helper for user config files.

Use it in:

- `~/.config/aimux/<profile>/aimux.config.ts`
- `~/.config/aimux/<profile>/aimux.config.js`

It is a typed pass-through helper, not a runtime loader by itself.

## `keymaps`

Status: `Supported`

Type:

```ts
keymaps?: (k: KeymapBuilderApi) => KeymapBuilderApi
```

Use this field to customize keybindings.

Builder methods:

- `leader(key)`
- `timeout(ms)`
- `mode(id | ids[], configure)`

Mode builder methods:

- `map(keys, action, description?)`
- `unmap(keys)`
- `group(prefix, name, configure)`
- `passthrough()`

Important runtime facts:

- shipped default leader is `<C-w>`
- shipped default timeout is `300`
- repeated `.mode()` calls merge
- same-key user bindings override earlier ones
- `unmap()` removes defaults by exact key string
- array mode definitions apply to every listed mode

See `../guide/keymaps.md` for notation and merge semantics.

## `projectBar`

Status: `Supported`

Type:

```ts
projectBar?: {
  initialVisible?: boolean
}
```

Runtime behavior:

- consumed during app initialization
- used as a higher-priority source than `aimux.json.projectBarVisible`
- reapplied on every launch while this config entry remains set

Example:

```ts
export default defineConfig({
  projectBar: {
    initialVisible: true,
  },
})
```

## `gitPane`

Status: `Supported`

Type:

```ts
interface GitPaneConfig {
  initialDiffModeRatio?: number // 0..1, clamped to [0.2, 0.8]
  initialFileListMode?: 'tree' | 'flat'
  initialTreeCompaction?: boolean
  path?: GitPanePathConfig
  diffCount?: GitPaneDiffCountConfig
  prefetchRadius?: number
}

type GitPanePathConfig = { enabled: false } | { enabled: true; pathFn?: (path: string) => string }

type GitPaneDiffCountConfig = { enabled: boolean }
```

Runtime behavior:

- Placement (`initialMode`, `initialPosition`, `initialRatio`, `initialVisible`)
  moved to the bars layout — see [`bars`](#bars). Those fields are still
  accepted so existing config files typecheck, but they are ignored.
- `initialDiffModeRatio` controls the file-list width while you are in
  full-screen git diff mode.
- `initialFileListMode` controls whether the git file list renders as a folder
  tree or as a flat list.
- `initialTreeCompaction` controls whether tree mode collapses unary directory
  chains at startup.
- `path.enabled: false` hides the directory part of each file path, showing
  only the basename. When `enabled: true`, an optional `pathFn` rewrites the
  path before rendering (e.g. stripping a prefix).
- `diffCount.enabled: false` hides the `+added / −removed` column.
- `prefetchRadius` is a regular config knob, not a persisted pane-state field.
- The `initial*` fields are startup overrides. Current runtime pane state is
  still persisted in `aimux.json`, but typed config values take precedence on
  every launch when present.

Example:

```ts
export default defineConfig({
  gitPane: {
    initialDiffModeRatio: 0.3,
    initialFileListMode: 'tree',
    initialTreeCompaction: true,
    path: {
      enabled: true,
      pathFn: (p) => p.replace(/^src\//, ''),
    },
    diffCount: { enabled: false },
  },
})
```

Legacy migration: config files written before `gitPane` existed stored
`gitPanelVisible` / `gitPanelRatio` at the root of `aimux.json`. Those keys
are read once on load and folded into the derived bars layout on the next
save.

## `theme`

Type:

```ts
theme?: {
  initialMode?: 'light' | 'dark'
  paletteOverrides?: Partial<AimuxPalette>
}
```

`theme.initialMode` picks the built-in light or dark family when there is no
persisted `aimux.json.themeId`.

`theme.paletteOverrides` customizes the active palette at startup and applies to
the resolved runtime theme regardless of whether the base theme came from
persisted state or from `initialMode`.

```ts
import { defineConfig } from '@brimveyn/aimux-config'

export default defineConfig({
  theme: {
    initialMode: 'dark',
    paletteOverrides: {
      primary: '#7dd3fc',
      warning: '#fbbf24',
    },
  },
})
```

See [`../guide/themes.md`](../guide/themes.md) for runtime picker behavior and
palette override guidance.

Precedence at startup: persisted `aimux.json.themeId` (if still known) →
`theme.initialMode` → built-in dark fallback. `paletteOverrides` applies on top
of the chosen base theme.

## `backends`

Status: `Typed surface only`

Type:

```ts
backends?: Record<string, BackendConfig>
```

`BackendConfig`:

```ts
interface BackendConfig {
  command: string
  args?: string[]
}
```

Notes:

- the config package resolves this field
- helper functions such as `claudeBackend()`, `codexBackend()`, and `kimiBackend()` are exported
- the helper module explicitly documents runtime wiring as deferred

Do not present this as a fully working runtime backend override surface today.

## `bars`

Status: `Runtime state, not typed config`

The left and right bars — and which widgets sit in each — are app-managed state
persisted in `aimux.json` under `bars`, not something you declare in
`aimux.config.ts`:

```ts
interface PersistedBars {
  left: PersistedBar
  right: PersistedBar
}

interface PersistedBar {
  visible: boolean
  width: number // cells, clamped to [18, 80]
  widgets: { id: string; grow: number; visible: boolean }[] // ordered top → bottom
}
```

Widget ids: `projects`, `git`. Move a widget between bars, reorder it, or
hide it with the right-click menu on the widget. `<C-b>` toggles the left bar,
`<Leader>B` the right one.

Config files written before bars existed are upgraded automatically from the
old `sidebar` + `gitPane.mode`/`position` fields on first load.

## `hooks`

Status: `Typed surface only`

Type:

```ts
interface HooksConfig {
  onSessionCreate?: (session: { name: string; projectPath?: string }) => void | Promise<void>
}
```

This is currently a typed API surface, not a documented runtime feature.

## `snippets`

Status: `Supported`

Type:

```ts
interface SnippetDef {
  name: string
  trigger?: string
  text: string
  vars?: Record<string, SnippetVar>
}

interface SnippetShellVar {
  sh: string
  timeout?: number // ms, default 5000
  trim?: boolean // default true
}

type SnippetVar = SnippetShellVar
```

Runtime behavior:

- snippets are loaded from `aimux-snippets.json` (user-edited, JSON catalog)
- snippets declared in `aimux.config.ts` are merged into the runtime catalog
  with id prefix `config:` and treated as read-only in the picker
- `vars` are only honored on `config:` snippets — any `vars` field on a
  user-catalog snippet is stripped on load (security: only the typed config
  may declare shell execution)
- a snippet whose `trigger` matches an inline-typed sequence expands the
  `text` with `{{name}}` variable substitution and `$|` cursor placement

See `../guide/snippets.md` for the full reference.

## `snippetTriggerChar`

Status: `Supported`

Type:

```ts
/** Single-character prefix that opens an inline trigger. Default: `:`. */
snippetTriggerChar?: string
```

A non-single-character value falls back to `:` at resolution time. See
`../guide/snippets.md`.

## `autoCommit`

Status: `Supported`

Type:

```ts
autoCommit?: {
  enabled?: boolean                          // default: false
  timeoutMs?: number                         // default: 60_000
  models?: Partial<Record<string, string>>   // per-provider model override
}
```

Controls the AI-assisted commit message flow surfaced in the commit modal
(`c` in git mode). When `enabled: false` (the default), the `[ Auto-commit ]`
button is hidden, `Ctrl+A` surfaces a status message pointing here, and no
background request is ever made. When `enabled: true`:

- A background driver watches the working tree and pre-generates a commit
  message (Claude Haiku by default) whenever the tree stays stable for ~2 s.
- The `[ Auto-commit ]` button and `Ctrl+A` inside the modal consume the
  cached suggestion if ready, or show a loading overlay until it arrives.
- Manual staging is respected: with files already staged, the generated
  message (and the actual commit) only cover the staged set; with nothing
  staged, `git add -A` is run before committing.

Supported providers: `claude`, `codex`, `opencode`, `grok`, `kimi`. The active tab's
assistant determines which CLI is invoked.

Example:

```ts
export default defineConfig({
  autoCommit: {
    enabled: true,
    models: {
      claude: 'claude-haiku-4-5',
      codex: 'gpt-5-mini',
    },
    timeoutMs: 60_000,
  },
})
```

See [`../guide/git-mode.md#auto-commit`](../guide/git-mode.md#auto-commit)
for the full user-facing walkthrough.

## `autoRename`

Status: `Supported`

```ts
autoRename?: {
  enabled?: boolean                          // default: true
  timeoutMs?: number                         // default: 15_000
  models?: Partial<Record<string, string>>   // per-provider model override
  settleMs?: number                          // default: 2_500
  maxAttempts?: number                       // default: 3
  minPromptWords?: number                    // default: 3
}
```

After the first prompt that actually describes work, aimux runs that same
assistant's headless CLI in the background and replaces the default tab label
with a concise title. Explicit `--title` values and manual renames are never
overwritten.

- `settleMs` — quiet period before generating. Prompts submitted inside the
  window are folded into the same request, so a rapid "read X" / "now do Y"
  opening produces one title covering both. `0` generates on the first prompt.
- `minPromptWords` — prompts below this length are treated as dialog answers
  and ignored, as are slash commands, `!` shell escapes and confirmations like
  `y` or `1`. Ignoring a prompt costs nothing: the tab stays armed.
- `maxAttempts` — how many generations may fail before aimux gives up on the
  CLI and derives a title from the prompt text locally. Failures in between
  (non-zero exit, timeout, unusable output) leave the tab armed, so the next
  prompt tries again. A provider whose CLI is not installed skips straight to
  the local title.

The first prompt is sent to the configured provider as an additional model
request. Disable this feature if prompts must not leave the interactive
assistant process. Supported providers are `claude`, `codex`, `opencode`,
`grok`, and `kimi`; plain terminals and custom providers are ignored.

```ts
export default defineConfig({
  autoRename: {
    enabled: true,
    models: {
      claude: 'claude-haiku-4-5',
      codex: 'gpt-5-mini',
    },
  },
})
```

The daemon reads this setting at startup. Run `aimux restart-daemon` after
changing it; live PTYs remain owned by the terminal-manager.

## `multiRepo`

Status: `Supported`

Type:

```ts
multiRepo?: {
  enabled?: boolean // default: true
  maxDepth?: number // default: 1 (direct children only)
}
```

When a session's `projectPath` contains nested git repositories, aimux scans
for them once per session and merges their status into a single aggregated
git panel. In flat list mode each file is tagged with a short disambiguating
prefix (1, 2, or more letters — extended only where names collide) so you can
tell at a glance which sub-repo a file belongs to; in tree mode the regular
path hierarchy is preserved. Within each section (staged / unstaged /
untracked), files are grouped by repo before being sorted by path.

- `enabled: true` (default) turns discovery on.
- `maxDepth: 1` scans the direct children of `projectPath`. Set `2` to also
  descend one level further for deeply nested layouts.
- Discovery results are cached per `(projectPath, maxDepth)` — the scan runs
  once per session.
- Sub-repo commands (stage / unstage / discard / diff) are routed to each
  file's originating repository automatically.
- If `projectPath` is itself a git repo, its files appear first (no prefix)
  and sub-repo files follow.

Example:

```ts
export default defineConfig({
  multiRepo: {
    enabled: true,
    maxDepth: 1,
  },
})
```

Set `enabled: false` to fall back to single-repo behaviour (no discovery, no
prefix).

## `statusBar`

Status: `Supported`

Type:

```ts
interface StatusBarConfig {
  aiUsage?: AIUsageToolConfig
  separator?: 'arrow' | 'round' | 'slant' | 'flame' | 'none' // default 'arrow'
}

interface AIUsageToolConfig {
  enabled?: boolean // default false
  tools?: Array<'claude' | 'codex'> // default ['claude', 'codex']
  pollSeconds?: number // default 180; clamped to a minimum of 180 (Claude's endpoint rate-limits faster callers)
  claudePlan?: 'auto' | 'pro' | 'max5' | 'max20' // default 'auto'; reserved
  codexWeeklyLimit?: number // reserved
}
```

Runtime behavior:

- when `aiUsage.enabled !== true` the indicator is hidden and no polling happens
- the indicator lives on the right side of the status bar and supports click to
  open a details popover
- Claude data comes from `api.anthropic.com/api/oauth/usage` using the
  OAuth token stored in the macOS Keychain (`Claude Code-credentials`)
- Codex data comes from `chatgpt.com/backend-api/wham/usage` using the OAuth
  token stored in `~/.codex/auth.json`
- all colors are pulled from the active theme palette; no hardcoded colors

### `separator`

Powerline-style glyph rendered between the status bar sections (mode badge,
session/path tile, AI usage tile, version tile). All non-`none` options require
a nerd-font / powerline-capable font.

| Value   | Right glyph | Left glyph | Codepoints                                           |
| ------- | :---------: | :--------: | ---------------------------------------------------- |
| `arrow` |             |            | U+E0B0 / U+E0B2                                      |
| `round` |             |            | U+E0B4 / U+E0B6                                      |
| `slant` |             |            | U+E0BC / U+E0BA                                      |
| `flame` |             |            | U+E0C0 / U+E0C2                                      |
| `none`  |      —      |     —      | (no glyph; sections snap via background colour only) |

Resolved once at app startup and persisted for the session.

See [`../guide/ai-usage-indicator.md`](../guide/ai-usage-indicator.md) for the
full AI usage guide, field reference, and platform requirements.

Example:

```ts
export default defineConfig({
  statusBar: {
    separator: 'round',
    aiUsage: {
      enabled: true,
      pollSeconds: 180,
      tools: ['claude', 'codex'],
    },
  },
})
```

## `workspaceTemplates` — removed

Workspace templates spawned a fixed set of tabs and split panes at workspace
creation, each pane optionally prefilled with a command. They are gone.

Their provisioning half — `send: 'bun install'` fired on a timer, with no exit
code and no per-project scoping — is now a per-project **setup script**, which
runs with the workspace as its working directory and reports its exit code. See
`../guide/workspaces.md#setup-script`.

Their layout half has no replacement: open the tabs and splits you want, or ask
an assistant to.

A config that still declares `workspaceTemplates` (or the older
`worktreeTemplates`) does nothing. `aimux doctor` reports it, because an unknown
key otherwise parses silently.

## Actions

`actions` exports the built-in action catalog used by keymaps.

Common groups:

- tabs: `nextTab`, `prevTab`, `newTab`, `renameTab`, `closeTab`, `restartTab`
- projects: `projectPicker`, `switchProjectByIndex(n)` and project modal actions
- snippets: `snippetPicker`, snippet filter and editor actions
- themes: `themePicker`, `previewTheme`, `confirmTheme`, `restoreTheme`
- panes: `splitVertical`, `splitHorizontal`, `focusPane`, `resizePane`, `closePane`
- UI: `toggleSidebar`, `resizeSidebar`, `toggleProjectBar`, `toggleGitPane`,
  `resizeGitPane(delta)`, `setGitPaneMode(mode)`, `setGitPanePosition(position)`
- modes: `enterInsert`, `leaveTerminalInput`, `closeModal`, `helpModal`
- git: `enterGitMode`, `exitGitMode`, stage/unstage/delete, commit, push

You can also provide your own `ActionFn` for dynamic runtime behavior.

## Themes API

Exports:

- `themes.define(name, baseThemeId, overrides)` — palette shortcut. Patch VSCode
  color keys on top of `baseThemeId`. Returns a `NamedThemeDefinition`.
- `themes.full(theme)` — pass-through for a raw `NamedTheme` (shiki theme JSON
  with `name`, `displayName`, `type`, `colors`, `settings`, …).
- `themes.extend(baseThemeId, overrides)` — unnamed variant of `define`
  (lower-level).
- `AIMUX_COLOR_KEYS` — the VSCode color keys aimux's UI reads.
- `THEME_IDS` — all shipped theme ids (shiki + house).
- `THEMES` — record mapping id to a full `Theme` object.

See [`../guide/themes.md`](../guide/themes.md) for the full list of shipped
themes and picker usage.

## Tooling Types

The package exports many additional types such as `ResolvedConfig`, `AppState`,
`ModeContext`, and `ResolvedKeymapConfig`.

Those exports are useful for tooling and integration, but not all of them should
be interpreted as stable end-user runtime promises.
