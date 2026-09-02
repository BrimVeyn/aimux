// Public API — what users import from '@brimveyn/aimux-config'.

export { defineConfig } from './define-config'
export * as actions from './actions'

// TUI theme system (1:1 port of opencode TUI).
export {
  BUILTIN_THEME_IDS,
  type ClaudeThemeFile,
  clearRuntimeThemes,
  getTuiTheme,
  isKnownThemeId,
  migrateThemeId,
  registerTuiTheme,
  resolveClaudeTheme,
  type ResolvedTuiTheme,
  resolveTuiTheme,
  type RGBA,
  type ThemeId,
  themeIds,
  type ThemeMode,
  TUI_COLOR_TOKENS,
  TUI_THEMES,
  type TuiColorToken,
  type TuiColorValue,
  type TuiShikiOptions,
  type TuiThemeJson,
  tuiThemeToShiki,
} from './tui'

export { GroupBuilder, KeymapBuilder, ModeBindingBuilder } from './keymap-builder'
export { getDefaultKeymapConfig } from './defaults'
export { resolveConfig } from './resolver'
export { isAutoCommitEnabled, setAutoCommitEnabled } from './auto-commit-runtime'
export {
  clearPluginActions,
  hasPluginAction,
  pluginAction,
  pluginActionNames,
  registerPluginAction,
} from './plugin-actions-runtime'
export { getMultiRepoConfig, setMultiRepoConfig } from './multi-repo-runtime'
export { getStatusBarSeparator, setStatusBarSeparator } from './status-bar-runtime'
export {
  DEFAULT_EDITOR_ARGS,
  getExternalEditorConfig,
  KNOWN_GUI_EDITORS,
  setExternalEditorConfig,
} from './external-editor-runtime'
export { DEFAULT_MULTI_REPO_CONFIG } from './defaults'

// The application state, mode and layout shapes. Defined in this package —
// `src/` re-exports them rather than declaring its own copies.
export type * from './app-types'

// User-facing config types (keymap/backends/projects/etc.).
export type {
  Action,
  ActionFn,
  AimuxThemeConfig,
  AimuxUserConfig,
  AIUsageTool,
  AIUsageToolConfig,
  AppAction,
  AutoCommitConfig,
  AutoRenameConfig,
  BackendConfig,
  BindingDef,
  ExternalEditorConfig,
  GitPaneConfig,
  GitPaneEmbeddedConfig,
  GitPanePaneConfig,
  GroupBuilderApi,
  HooksConfig,
  KeyInput,
  KeymapBuilderApi,
  KeyResult,
  LayoutLeaf,
  LayoutNode,
  LayoutSplit,
  ModeBindingBuilderApi,
  ModeContext,
  ModeId,
  ModeKeymapDef,
  MultiRepoConfig,
  PluginConfigDecl,
  PluginConfigEntry,
  ResolvedConfig,
  ResolvedKeymapConfig,
  SidebarConfig,
  SideEffect,
  SnippetDef,
  SnippetShellVar,
  SnippetVar,
  SplitDirection,
  StatusBarConfig,
  StatusBarSeparator,
} from './types'
