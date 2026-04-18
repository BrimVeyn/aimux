// Public API — this is what users import from '@brimveyn/aimux-config'

export { defineConfig } from './define-config'
export * as actions from './actions'
export { migrateThemeId, THEME_IDS, themes, THEMES } from './themes'
export { GroupBuilder, KeymapBuilder, ModeBindingBuilder } from './keymap-builder'
export { getDefaultKeymapConfig } from './defaults'
export { resolveConfig } from './resolver'

// Type exports
export type {
  // Action types
  Action,
  ActionFn,
  // User-facing config
  AimuxUserConfig,
  AppAction,
  AppState,
  BackendConfig,
  BindingDef,
  FocusMode,
  GitPaneConfig,
  GitPaneDiffCountConfig,
  GitPaneEmbeddedConfig,
  GitPanePaneConfig,
  GitPanePathConfig,
  GitPaneState,
  GroupBuilderApi,
  HooksConfig,
  KeyInput,
  // Keymap builder API (type surface)
  KeymapBuilderApi,
  KeyResult,
  // Layout
  LayoutNode,
  ModalState,
  ModeBindingBuilderApi,
  ModeContext,
  // Mode / state
  ModeId,
  ModeKeymapDef,
  NamedThemeDefinition,
  // Resolved config (internal, but exported for tooling)
  ResolvedConfig,
  ResolvedKeymapConfig,
  SessionRecord,
  SidebarConfig,
  SideEffect,
  SnippetDef,
  SnippetRecord,
  SplitDirection,
  TabSession,
  // Themes
  ThemeColors,
  ThemeDefinition,
  ThemeId,
} from './types'
