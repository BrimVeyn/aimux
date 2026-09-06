// -----------------------------------------------------------------------------
// The aimux keymap/config surface: everything a user's `aimux.config.ts` and a
// plugin author write against.
//
// The application state, mode and layout shapes it builds on live in
// `./app-types` and are re-exported here, so this module stays the one import
// a config file needs. Both halves are SOURCE definitions — `src/` re-exports
// from this package rather than declaring its own copies, which is what makes
// the two impossible to drift apart.
// -----------------------------------------------------------------------------

export type * from './app-types'

import type {
  GitFileListMode,
  GitPaneDiffCountConfig,
  GitPanePathConfig,
  KeyResult,
  ModeContext,
  ModeId,
} from './app-types'

// ─── Mode identifiers ─────────────────────────────────────────────────────────

// ─── Primitive app types ──────────────────────────────────────────────────────

export type SplitDirection = 'horizontal' | 'vertical'

// ─── Terminal data shapes ─────────────────────────────────────────────────────

// ─── Layout ───────────────────────────────────────────────────────────────────

/**
 * What occupies a pane. `tab` is a terminal; `plugin` is a renderer a plugin
 * registered, and has no PTY behind it.
 */
export type LayoutLeafKind = 'tab' | 'plugin'

export interface LayoutLeaf {
  type: 'leaf'
  /**
   * The tab id — or, when `kind` is `'plugin'`, the qualified pane id
   * (`<pluginId>.<paneId>`).
   *
   * Still called `tabId` because it is the key in every layout ever written to
   * `aimux.json`, and a rename would be a migration for the sake of a name.
   * Code that means "whatever is in this pane" should say so by using
   * `allPaneIds`; code that means "a terminal" uses `allTabIds`.
   */
  tabId: string
  /**
   * Absent means `'tab'`. Every persisted layout omits it, and every pane that
   * existed before plugins could hold one is a terminal.
   */
  kind?: LayoutLeafKind
}
export interface LayoutSplit {
  type: 'split'
  direction: SplitDirection
  ratio: number
  first: LayoutNode
  second: LayoutNode
}
export type LayoutNode = LayoutLeaf | LayoutSplit

// ─── Side effects ─────────────────────────────────────────────────────────────

// ─── Key input / KeyResult / ModeContext ──────────────────────────────────────

// ─── Themes ───────────────────────────────────────────────────────────────────

// Theme types now live in `./tui` (1:1 port of opencode TUI). The aliases
// below preserve internal type wiring for the user-facing config API.

export type ThemeMode = 'light' | 'dark'

// ─── Backend config (stub) ────────────────────────────────────────────────────

export interface BackendConfig {
  command: string
  args?: string[]
}

// ─── Sidebar config (stub) ────────────────────────────────────────────────────

export interface SidebarConfig {
  widgets?: string[]
  width?: number
}

// ─── Hooks config (stub) ──────────────────────────────────────────────────────

export interface HooksConfig {
  onProjectCreate?: (project: { name: string; projectPath?: string }) => void | Promise<void>
}

// ─── Plugin config ────────────────────────────────────────────────────────────

/**
 * A plugin declared from `aimux.config.ts` rather than through
 * `aimux plugin link`. Either form works; this one is the version-controllable
 * half, and it outranks `aimux-plugins.json` on every key it sets.
 */
export interface PluginConfigEntry {
  /**
   * Directory holding `aimux-plugin.json`. Relative paths resolve against the
   * profile config directory — the one `aimux.config.ts` itself lives in.
   * Omit it to configure a plugin that is already linked or installed.
   */
  path?: string
  /**
   * Plugin id. Required when there is no `path`; otherwise it is checked
   * against the manifest so a moved directory fails loudly instead of loading
   * something else.
   */
  id?: string
  /** Default true. `false` keeps the plugin registered but never loads it. */
  enabled?: boolean
  /** Merged over the manifest defaults and the registry, and wins over both. */
  config?: Record<string, unknown>
  /** Per-binding overrides keyed by the manifest binding id. `null` unbinds it. */
  keymaps?: Record<string, string | null>
}

/** A bare string is shorthand for `{ path }`. */
export type PluginConfigDecl = string | PluginConfigEntry

// ─── Snippet config (stub) ────────────────────────────────────────────────────

/**
 * A snippet variable resolved at expansion time. The shape is a tagged union
 * discriminated by which key is present (`sh` for now; future: `env`, `date`, …).
 */
export interface SnippetShellVar {
  /** Shell command run via `sh -c`. The trimmed stdout is interpolated. */
  sh: string
  /** Kill the process after this many ms. Default 5000. */
  timeout?: number
  /** Trim trailing whitespace from stdout. Default true. */
  trim?: boolean
}

export type SnippetVar = SnippetShellVar

export interface SnippetDef {
  name: string
  trigger?: string
  text: string
  /**
   * Optional named variables. Reference them in `text` as `{{name}}`.
   * The key is the variable name; the value declares how to resolve it.
   */
  vars?: Record<string, SnippetVar>
}

// ─── Action value types ───────────────────────────────────────────────────────

export type ActionFn = (ctx: ModeContext) => KeyResult | null
export type Action = KeyResult | ActionFn

// ─── Keymap builder API types ─────────────────────────────────────────────────

export interface BindingOptions {
  repeatable?: boolean
}

export interface GroupBuilderApi {
  map(keys: string, action: Action, description?: string, opts?: BindingOptions): GroupBuilderApi
  group(
    prefix: string,
    name: string,
    configure: (g: GroupBuilderApi) => GroupBuilderApi
  ): GroupBuilderApi
}

export interface ModeBindingBuilderApi {
  map(
    keys: string,
    action: Action,
    description?: string,
    opts?: BindingOptions
  ): ModeBindingBuilderApi
  unmap(keys: string): ModeBindingBuilderApi
  group(
    prefix: string,
    name: string,
    configure: (g: GroupBuilderApi) => GroupBuilderApi
  ): ModeBindingBuilderApi
  passthrough(): ModeBindingBuilderApi
}

export interface KeymapBuilderApi {
  leader(key: string): KeymapBuilderApi
  timeout(ms: number): KeymapBuilderApi
  mode(
    id: ModeId | readonly ModeId[],
    configure: (m: ModeBindingBuilderApi) => ModeBindingBuilderApi
  ): KeymapBuilderApi
  /**
   * Binds an action a plugin contributes, by its qualified `<pluginId>.<verb>`
   * name:
   *
   * ```ts
   * k.mode('navigation', (m) => m.map('<leader>r', k.plugin('acme.review.open')))
   * ```
   *
   * A name, not a function, because the keymap is resolved at startup and
   * plugins load after it. Requiring an import would mean a config file could
   * only reference plugins it could reach — the coupling a plugin system
   * exists to remove. An unresolved name is inert, the way an unbound key is.
   */
  plugin(name: string): Action
}

// ─── Top-level user config ────────────────────────────────────────────────────

export interface ProjectBarConfig {
  /** Startup override for the project bar visibility. Reapplied on each launch. */
  initialVisible?: boolean
  /** @deprecated Use `initialVisible` instead. */
  visible?: boolean
}

// ─── Git pane config (discriminated union) ────────────────────────────────────

interface GitPaneBaseConfig {
  /** Startup override for git pane visibility. Reapplied on each launch. */
  initialVisible?: boolean
  /** Startup override for the pane split ratio. Reapplied on each launch. */
  initialRatio?: number
  /** Startup override for fullscreen diff ratio. Reapplied on each launch. */
  initialDiffModeRatio?: number
  /** Startup override for tree/flat file list mode. Reapplied on each launch. */
  initialFileListMode?: GitFileListMode
  /** Startup override for tree compaction. Reapplied on each launch. */
  initialTreeCompaction?: boolean
  path?: GitPanePathConfig
  diffCount?: GitPaneDiffCountConfig
  /** Prefetch N neighbouring diffs around the cursor; 0 disables. */
  prefetchRadius?: number
  /** @deprecated Use `initialVisible` instead. */
  visible?: boolean
  /** @deprecated Use `initialRatio` instead. */
  ratio?: number
  /** @deprecated Use `initialDiffModeRatio` instead. */
  diffModeRatio?: number
  /** @deprecated Use `initialFileListMode` instead. */
  fileListMode?: GitFileListMode
  /** @deprecated Use `initialTreeCompaction` instead. */
  treeCompaction?: boolean
}

export interface GitPaneEmbeddedConfig extends GitPaneBaseConfig {
  initialMode?: 'embedded'
  initialPosition?: 'top' | 'bottom'
  /** @deprecated Use `initialMode` instead. */
  mode?: 'embedded'
  /** @deprecated Use `initialPosition` instead. */
  position?: 'top' | 'bottom'
}

export interface GitPanePaneConfig extends GitPaneBaseConfig {
  initialMode: 'pane'
  initialPosition?: 'left' | 'right'
  /** @deprecated Use `initialMode` instead. */
  mode: 'pane'
  /** @deprecated Use `initialPosition` instead. */
  position?: 'left' | 'right'
}

export type GitPaneConfig = GitPaneEmbeddedConfig | GitPanePaneConfig

export interface AutoCommitConfig {
  enabled: boolean
  timeoutMs: number
  models: Partial<Record<string, string>>
}

export interface AutoRenameConfig {
  enabled: boolean
  timeoutMs: number
  models: Partial<Record<string, string>>
  /**
   * Quiet period after a title-worthy prompt before a title is generated.
   * Prompts submitted inside the window are appended to the same request, so a
   * "read X" / "now do Y" opening yields one title instead of two.
   */
  settleMs: number
  /** Generation attempts before falling back to a title derived locally from the prompt. */
  maxAttempts: number
  /**
   * Prompts with fewer words than this are treated as menu answers or
   * confirmations and ignored (they do not consume an attempt).
   */
  minPromptWords: number
}

export interface MultiRepoConfig {
  /** When true, scan projectPath for nested git repos and aggregate their status into the git panel. */
  enabled: boolean
  /** How deep to scan below projectPath when discovering sub-repos. 1 = immediate children only. */
  maxDepth: number
}

export interface AimuxThemeConfig {
  /** Startup theme id (one of `THEME_IDS` from `@brimveyn/aimux-config`). */
  initialId?: string
  /** Startup override for light/dark mode. Reapplied on each launch. */
  initialMode?: ThemeMode
  /** @deprecated Use `initialMode` instead. */
  mode?: ThemeMode
  /**
   * Beta — bridge the active aimux theme into Claude Code by writing
   * `~/.claude/themes/aimux.json` and selecting it in `~/.claude/settings.json`.
   * Off by default. Requires Claude Code v2.1.118 or later.
   */
  beta?: {
    harmonizeClaudeTheme?: boolean
    /**
     * Draw each agent state (idle, working, waiting, done) as a small animated
     * sprite rather than a spinner and a set of dots. Needs a terminal that
     * speaks the Kitty graphics protocol (Kitty, Ghostty, WezTerm) and does not
     * work under tmux. Sprites are read from `<config dir>/sprites`, falling
     * back to the ones aimux ships.
     */
    experimentalActivitySprites?: boolean
    /**
     * Disable Claude Code's built-in syntax highlighting and re-color diff
     * lines from the aimux theme via shiki. Sets
     * `CLAUDE_CODE_SYNTAX_HIGHLIGHT=false` for child PTYs and post-processes
     * the terminal snapshot in the app.
     */
    experimentalSyntaxHighlight?: boolean
  }
}

/**
 * A tool the usage indicator can poll. Widened with `(string & {})` because a
 * plugin assistant can declare a `usage` adapter and its id is not knowable
 * here; the literal half survives, so the built-in two still autocomplete.
 */
export type AIUsageTool = 'claude' | 'codex' | (string & {})

export interface AIUsageToolConfig {
  /**
   * Whether the indicator runs. The same switch as
   * `plugins: [{ id: 'aimux.ai-usage', enabled }]`, kept because it is the key
   * the feature had before it was a plugin. Off by default: the service reads
   * the Claude keychain entry and calls two OAuth endpoints.
   */
  enabled?: boolean
  pollSeconds?: number
  claudePlan?: 'auto' | 'pro' | 'max5' | 'max20'
  codexWeeklyLimit?: number
  tools?: AIUsageTool[]
}

export type StatusBarSeparator = 'arrow' | 'round' | 'slant' | 'flame' | 'none'

export interface StatusBarConfig {
  aiUsage?: AIUsageToolConfig
  /** Second row of keybinding hints under the bar. Default `true`. */
  hints?: boolean
  /**
   * Powerline-style glyph used between status bar sections.
   * - `arrow` (default): solid triangles (    / )
   * - `round`: solid semicircles (    / )
   * - `slant`: solid slopes (    / )
   * - `flame`: solid flame ribbons (    / )
   * - `none`: no glyph, sections snap via background colour only
   *
   * All non-`none` options require a nerd-font / powerline-capable font.
   */
  separator?: StatusBarSeparator
}

export interface ExternalEditorConfig {
  /** Override `$VISUAL` / `$EDITOR`. */
  command?: string
  /**
   * Force GUI (detached spawn — for vscode/cursor/etc.) or TUI (inline shellout
   * that hands the TTY to the editor). Defaults: GUI for editors in a built-in
   * allowlist (`code`, `cursor`, `subl`, JetBrains, …), TUI otherwise.
   */
  kind?: 'gui' | 'tui'
  /** Argv passed to the editor. Placeholders: `{file}`, `{line}`. Sensible defaults per known editor. */
  args?: string[]
  /**
   * Opt-in escape hatch for TUI editors only: when set, the TUI editor is
   * launched in a new terminal window using this argv template instead of the
   * default inline shellout. Ignored when `kind` resolves to `'gui'` — GUI
   * editors always spawn detached into their own app window.
   *
   * Placeholders: `{cmd}` (shell-quoted `cd <cwd> && <editor> <args>`), `{cwd}`.
   * Example: `['wezterm', 'start', '--cwd', '{cwd}', '--', 'sh', '-c', '{cmd}']`.
   */
  terminal?: string[]
}

export interface AimuxIntegrationsConfig {
  /**
   * Opt-in: install Claude Code lifecycle hooks into `~/.claude/settings.json`
   * so per-tab activity (working / waiting-input / idle) is driven by Claude's
   * own events rather than visual scraping of the terminal. Off by default.
   *
   * When enabled, aimux writes six entries marked `__aimux: true` into the
   * user's settings file at startup, and the daemon publishes a hook URL on
   * `127.0.0.1` for Claude to call back into. Unrelated hooks the user has
   * configured are preserved. See `docs/guide/claude-integration.md`.
   */
  claudeHooks?: boolean
}

export interface AimuxUserConfig {
  theme?: AimuxThemeConfig
  keymaps?: (k: KeymapBuilderApi) => KeymapBuilderApi
  backends?: Record<string, BackendConfig>
  sidebar?: SidebarConfig
  projectBar?: ProjectBarConfig
  /** @deprecated renamed to `projectBar`. Still read in 0.9.0. */
  sessionBar?: ProjectBarConfig
  gitPane?: GitPaneConfig
  hooks?: HooksConfig
  snippets?: SnippetDef[]
  /**
   * Single-character prefix that opens an inline snippet trigger.
   * Defaults to `:` (Espanso-style). Typing `<char><trigger><separator>` in
   * any non-alternate-screen terminal expands the matching snippet.
   */
  snippetTriggerChar?: string
  autoCommit?: Partial<AutoCommitConfig>
  autoRename?: Partial<AutoRenameConfig>
  multiRepo?: Partial<MultiRepoConfig>
  statusBar?: StatusBarConfig
  externalEditor?: ExternalEditorConfig
  integrations?: AimuxIntegrationsConfig
  /**
   * Plugins to load, in addition to anything `aimux plugin link/install`
   * registered. See `docs/developer/plugins.md`.
   */
  plugins?: PluginConfigDecl[]
  /**
   * @deprecated Removed. Workspace provisioning is a per-project setup script
   * now — see `docs/guide/workspaces.md#setup`. Declared here only so the strike
   * -through shows up in your editor: an unknown key parses silently, so without
   * it the setting would just vanish with no signal at all.
   */
  workspaceTemplates?: never
  /** @deprecated Removed. See `workspaceTemplates`. */
  worktreeTemplates?: never
}

// ─── Resolved config (internal) ───────────────────────────────────────────────

export interface BindingDef {
  keys: string
  result: Action
  group?: string
  description?: string
  repeatable?: boolean
}

export interface ModeKeymapDef {
  bindings: BindingDef[]
  removals: string[]
  isPassthrough: boolean
}

export interface ResolvedKeymapConfig {
  leader: string
  timeout: number
  modes: Map<ModeId, ModeKeymapDef>
}

export interface ResolvedConfig {
  theme:
    | {
        initialId?: string
        initialMode?: ThemeMode
        beta?: {
          harmonizeClaudeTheme?: boolean
          experimentalSyntaxHighlight?: boolean
        }
      }
    | undefined
  keymaps: ResolvedKeymapConfig
  backends: Record<string, BackendConfig>
  sidebar: SidebarConfig
  projectBar: {
    initialVisible?: boolean
  }
  /**
   * Placement (`initialMode`/`initialPosition`/`initialRatio`/`initialVisible`)
   * moved to the bars layout in `aimux.json`; those fields are still accepted
   * in user config but ignored.
   */
  gitPane: {
    initialDiffModeRatio?: number
    initialFileListMode?: GitFileListMode
    initialTreeCompaction?: boolean
    path?: GitPanePathConfig
    diffCount?: GitPaneDiffCountConfig
    prefetchRadius?: number
  }
  hooks: HooksConfig
  snippets: SnippetDef[]
  snippetTriggerChar: string
  autoCommit: AutoCommitConfig
  autoRename: AutoRenameConfig
  multiRepo: MultiRepoConfig
  statusBar: StatusBarConfig
  externalEditor: ExternalEditorConfig
  integrations: {
    claudeHooks: boolean
  }
  /** Normalised to the object form; a bare string became `{ path }`. */
  plugins: PluginConfigEntry[]
}
