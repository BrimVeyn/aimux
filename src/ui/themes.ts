// Thin runtime re-export. Theme data, types, and the palette-to-Shiki generator
// all live in `@brimveyn/aimux-config`.

export type {
  AimuxPalette,
  AimuxTheme,
  AimuxThemeConfig,
  ResolvedToken,
  ResolvedTokens,
  Theme,
  ThemeId,
  ThemeMode,
  ThemeVariantOverrides,
} from '@brimveyn/aimux-config'

export {
  extendPalette,
  isKnownThemeId,
  migrateThemeId,
  paletteToShikiTheme,
  resolveTheme,
  THEME_IDS,
  THEMES,
} from '@brimveyn/aimux-config'
