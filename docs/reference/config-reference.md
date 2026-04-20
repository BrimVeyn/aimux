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
  theme?: ThemeId
  themes?: Record<string, NamedThemeDefinition>
  keymaps?: (k: KeymapBuilderApi) => KeymapBuilderApi
  backends?: Record<string, BackendConfig>
  sidebar?: SidebarConfig
  sessionBar?: SessionBarConfig
  gitPane?: GitPaneConfig
  hooks?: HooksConfig
  snippets?: SnippetDef[]
  statusBar?: StatusBarConfig
})
```

## Support Matrix

| Field        | Status             | Notes                                                                                     |
| ------------ | ------------------ | ----------------------------------------------------------------------------------------- |
| `keymaps`    | Supported          | Fully resolved and registered by the app                                                  |
| `sessionBar` | Supported          | Used during app initialization; can override `aimux.json` values                          |
| `gitPane`    | Supported          | Controls placement and rendering of the git file list (see below)                         |
| `theme`      | Supported          | Initial theme id. Persisted `aimux.json.themeId` wins if present                          |
| `themes`     | Supported          | User-defined themes; appear in the picker and power synthesized Shiki highlighting        |
| `backends`   | Typed surface only | Resolved by the config package, but current runtime wiring is deferred                    |
| `sidebar`    | Typed surface only | Type exists, but current runtime sidebar state comes from app-managed state and snapshots |
| `hooks`      | Typed surface only | Type exists; runtime use is not currently wired                                           |
| `snippets`   | Typed surface only | Type exists, but snippets are currently loaded from `aimux-snippets.json`                 |
| `statusBar`  | Supported          | Hosts the `aiUsage` sub-block that powers the AI session usage indicator                  |

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

## `sessionBar`

Status: `Supported`

Type:

```ts
sessionBar?: {
  visible?: boolean
  position?: 'top' | 'bottom'
}
```

Runtime behavior:

- consumed during app initialization
- used as a higher-priority source than `aimux.json.sessionBarVisible`
- used as a higher-priority source than `aimux.json.sessionBarPosition`

Example:

```ts
export default defineConfig({
  sessionBar: {
    position: 'bottom',
    visible: true,
  },
})
```

## `gitPane`

Status: `Supported`

Type (discriminated union on `mode`):

```ts
type GitPaneConfig =
  | {
      mode?: 'embedded' // default
      position?: 'top' | 'bottom' // default 'bottom'
      visible?: boolean
      ratio?: number // 0..1, clamped to [0.2, 0.8]
      diffModeRatio?: number // 0..1, clamped to [0.2, 0.8]
      fileListMode?: 'tree' | 'flat'
      path?: GitPanePathConfig
      diffCount?: GitPaneDiffCountConfig
    }
  | {
      mode: 'pane'
      position?: 'left' | 'right' // default 'left'
      visible?: boolean
      ratio?: number
      diffModeRatio?: number
      fileListMode?: 'tree' | 'flat'
      path?: GitPanePathConfig
      diffCount?: GitPaneDiffCountConfig
    }

type GitPanePathConfig = { enabled: false } | { enabled: true; pathFn?: (path: string) => string }

type GitPaneDiffCountConfig = { enabled: boolean }
```

Runtime behavior:

- `mode: 'embedded'` renders the git file list inside the sidebar, above or
  below the tab list depending on `position`.
- `mode: 'pane'` renders the git file list as a standalone pane next to the
  sidebar (`left`) or on the far right of the main area (`right`).
- `position` allowed values are constrained per `mode` at the type level —
  `{ mode: 'embedded', position: 'left' }` is a type error.
- `ratio` controls size: in `embedded` mode it's the vertical split ratio
  against the tab list; in `pane` mode it maps to a column count in `[20, 80]`.
- `diffModeRatio` controls the file-list width while you are in full-screen git
  diff mode.
- `fileListMode` controls whether the git file list renders as a folder tree or
  as a flat list.
- `path.enabled: false` hides the directory part of each file path, showing
  only the basename. When `enabled: true`, an optional `pathFn` rewrites the
  path before rendering (e.g. stripping a prefix).
- `diffCount.enabled: false` hides the `+added / −removed` column.
- `visible`, `ratio`, `diffModeRatio`, and `fileListMode` are persisted across
  sessions in `aimux.json`. Programmatic config values take precedence over the
  persisted values when both are present.

Example:

```ts
export default defineConfig({
  gitPane: {
    mode: 'pane',
    position: 'right',
    diffModeRatio: 0.3,
    fileListMode: 'tree',
    ratio: 0.35,
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
are read once on load and converted to `{ mode: 'embedded', position: 'bottom',
ratio, visible }`, then persisted under `gitPane` on the next save.

## `theme` and `themes`

Type:

```ts
theme?: ThemeId
themes?: Record<string, NamedTheme | NamedThemeDefinition>
```

`theme` is the initial theme id applied at startup. It can be any shipped id
(shiki catalog + house themes `aimux` and `dracula-at-night`) or any key from
your own `themes` map.

`themes` declares user themes. Entries can be one of two shapes:

- `NamedThemeDefinition` — palette shortcut built via `themes.define(name, base, overrides)`. Overrides use VSCode workbench color keys.
- `NamedTheme` — full shiki-shape theme built via `themes.full({...})`. Use this to drop a VSCode theme JSON verbatim.

```ts
import { defineConfig, themes } from '@brimveyn/aimux-config'

export default defineConfig({
  theme: 'my-neon',
  themes: {
    'my-neon': themes.define('My Neon', 'aimux', {
      'textLink.foreground': '#ff00aa',
      'terminal.ansiMagenta': '#00ffcc',
    }),
  },
})
```

See [`../guide/themes.md`](../guide/themes.md) for the full VSCode color key
reference and the `themes.full` authoring form.

Precedence at startup: persisted `aimux.json.themeId` (if still known) → your
`theme` field → fallback `aimux`.

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
- helper functions such as `claudeBackend()` and `codexBackend()` are exported
- the helper module explicitly documents runtime wiring as deferred

Do not present this as a fully working runtime backend override surface today.

## `sidebar`

Status: `Typed surface only`

Type:

```ts
interface SidebarConfig {
  widgets?: string[]
  width?: number
}
```

Current runtime behavior is driven by app state and persisted workspace data,
not by this top-level typed config field.

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

Status: `Typed surface only`

Type:

```ts
interface SnippetDef {
  name: string
  trigger?: string
  text: string
}
```

Current runtime behavior:

- snippets are loaded from `aimux-snippets.json`
- the runtime seeds that file with default snippets on first use
- the top-level typed `snippets` field is not currently the main runtime source

## `statusBar`

Status: `Supported`

Type:

```ts
interface StatusBarConfig {
  aiUsage?: AIUsageToolConfig
}

interface AIUsageToolConfig {
  enabled?: boolean // default false
  tools?: Array<'claude' | 'codex'> // default ['claude', 'codex']
  pollSeconds?: number // default 60; clamped to a minimum of 5
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

See [`../guide/ai-usage-indicator.md`](../guide/ai-usage-indicator.md) for the
full guide, field reference, and platform requirements.

Example:

```ts
export default defineConfig({
  statusBar: {
    aiUsage: {
      enabled: true,
      pollSeconds: 60,
      tools: ['claude', 'codex'],
    },
  },
})
```

## Actions

`actions` exports the built-in action catalog used by keymaps.

Common groups:

- tabs: `nextTab`, `prevTab`, `newTab`, `renameTab`, `closeTab`, `restartTab`
- sessions: `sessionPicker`, `switchSessionByIndex(n)` and session modal actions
- snippets: `snippetPicker`, snippet filter and editor actions
- themes: `themePicker`, `previewTheme`, `confirmTheme`, `restoreTheme`
- panes: `splitVertical`, `splitHorizontal`, `focusPane`, `resizePane`, `closePane`
- UI: `toggleSidebar`, `resizeSidebar`, `toggleSessionBar`, `toggleGitPane`,
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
