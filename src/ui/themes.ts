// Thin runtime re-export. Theme data, types, normalization, and registration
// all live in `@brimveyn/aimux-config` so the dependency-free config package is
// the single source of truth. The mutable theme singleton + `applyTheme` stay
// in `./theme.ts` since they're UI-layer concerns.

export type {
  AimuxColorKey,
  NamedTheme,
  NamedThemeDefinition,
  Theme,
  ThemeColorMap,
  ThemeId,
  ThemeSettings,
  ThemeTokenRule,
} from '@brimveyn/aimux-config'

export {
  AIMUX_COLOR_KEYS,
  isKnownThemeId,
  migrateThemeId,
  normalizeTheme,
  registerUserThemes,
  THEME_IDS,
  THEMES,
} from '@brimveyn/aimux-config'
