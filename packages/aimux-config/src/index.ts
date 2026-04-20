// Public API — this is what users import from '@brimveyn/aimux-config'

export { defineConfig } from './define-config'
export * as actions from './actions'
export { isKnownThemeId, migrateThemeId, THEME_IDS, THEMES } from './themes'
export { HOUSE_THEME_IDS, HOUSE_THEMES } from './house-themes'
export { OPENCODE_THEME_IDS, OPENCODE_THEMES } from './themes/opencode'
export {
  accent,
  border,
  diffAddBg,
  diffDeleteBg,
  elevated,
  extendPalette,
  faint,
  hover,
  mix,
  muted,
  selected,
} from './palette-utils'
export { paletteToShikiTheme } from './palette-to-shiki'
export { GroupBuilder, KeymapBuilder, ModeBindingBuilder } from './keymap-builder'
export { getDefaultKeymapConfig } from './defaults'
export { resolveConfig } from './resolver'

// Type exports
export type {
  // Action types
  Action,
  ActionFn,
  AimuxPalette,
  AimuxTheme,
  AimuxThemeConfig,
  // User-facing config
  AimuxUserConfig,
  AppAction,
  AppState,
  AutoCommitConfig,
  BackendConfig,
  BindingDef,
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
  Theme,
  ThemeId,
  ThemeMode,
} from './types'
