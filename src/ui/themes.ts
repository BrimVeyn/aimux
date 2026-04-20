// Thin runtime re-export. Theme data, types, palette utilities, and the
// palette-to-Shiki generator all live in `@brimveyn/aimux-config`.

export type {
  AimuxPalette,
  AimuxTheme,
  AimuxThemeConfig,
  Theme,
  ThemeId,
  ThemeMode,
} from '@brimveyn/aimux-config'

export {
  accent,
  border,
  diffAddBg,
  diffDeleteBg,
  elevated,
  extendPalette,
  faint,
  hover,
  isKnownThemeId,
  migrateThemeId,
  mix,
  muted,
  paletteToShikiTheme,
  selected,
  THEME_IDS,
  THEMES,
} from '@brimveyn/aimux-config'
