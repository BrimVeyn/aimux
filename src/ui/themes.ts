// Thin runtime re-export of the TUI theme namespace.

export type {
  ResolvedTuiTheme,
  RGBA,
  ThemeId,
  ThemeMode,
  TuiColorToken,
  TuiColorValue,
  TuiThemeJson,
} from '@brimveyn/aimux-config'

export {
  BUILTIN_THEME_IDS,
  clearRuntimeThemes,
  getTuiTheme,
  isKnownThemeId,
  migrateThemeId,
  registerTuiTheme,
  resolveTuiTheme,
  themeIds,
  TUI_COLOR_TOKENS,
  TUI_THEMES,
} from '@brimveyn/aimux-config'
