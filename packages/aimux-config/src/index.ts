// Public API — what users import from '@brimveyn/aimux-config'.

export { defineConfig } from './define-config'
export * as actions from './actions'

// TUI theme system (1:1 port of opencode TUI).
export {
  type ClaudeThemeFile,
  isKnownThemeId,
  migrateThemeId,
  resolveClaudeTheme,
  type ResolvedTuiTheme,
  resolveTuiTheme,
  type RGBA,
  THEME_IDS,
  type ThemeId,
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
export { getMultiRepoConfig, setMultiRepoConfig } from './multi-repo-runtime'
export {
  DEFAULT_EDITOR_ARGS,
  getExternalEditorConfig,
  KNOWN_GUI_EDITORS,
  setExternalEditorConfig,
} from './external-editor-runtime'
export { DEFAULT_MULTI_REPO_CONFIG } from './defaults'

// User-facing config types (keymap/backends/sessions/etc.).
export type {
  Action,
  ActionFn,
  AimuxThemeConfig,
  AimuxUserConfig,
  AIUsageTool,
  AIUsageToolConfig,
  AppAction,
  AppState,
  AutoCommitConfig,
  BackendConfig,
  BindingDef,
  DiscoveredRepo,
  ExternalEditorConfig,
  FocusMode,
  GitFileListMode,
  GitPaneConfig,
  GitPaneDiffCountConfig,
  GitPaneEmbeddedConfig,
  GitPanePaneConfig,
  GitPanePathConfig,
  GitPaneState,
  GroupBuilderApi,
  HooksConfig,
  KeyInput,
  KeymapBuilderApi,
  KeyResult,
  LayoutNode,
  ModalState,
  ModeBindingBuilderApi,
  ModeContext,
  ModeId,
  ModeKeymapDef,
  MultiRepoConfig,
  MultiRepoState,
  ResolvedConfig,
  ResolvedKeymapConfig,
  SessionRecord,
  SidebarConfig,
  SideEffect,
  SnippetDef,
  SnippetRecord,
  SplitDirection,
  StatusBarConfig,
  TabSession,
} from './types'
