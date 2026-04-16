// Public API — this is what users import from '@brimveyn/aimux-config'

export { defineConfig } from './define-config'
export * as actions from './actions'
export { THEME_IDS, themes, THEMES } from './themes'
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
  // Themes
  ThemeColors,
  ThemeDefinition,
  ThemeId,
} from './types'
