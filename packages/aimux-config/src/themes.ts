import type {
  NamedTheme,
  NamedThemeDefinition,
  Theme,
  ThemeColorMap,
  ThemeDefinition,
  ThemeId,
} from './types'

import { HOUSE_THEME_IDS, HOUSE_THEMES } from './house-themes'
import { GENERATED_THEME_IDS, GENERATED_THEMES } from './themes.generated'

export const THEMES: Record<string, Theme> = { ...GENERATED_THEMES, ...HOUSE_THEMES }
export const THEME_IDS: ThemeId[] = [...GENERATED_THEME_IDS, ...HOUSE_THEME_IDS]

const LEGACY_THEME_ALIASES: Record<string, ThemeId> = {
  'everforest': 'everforest-dark',
  'gruvbox-dark': 'gruvbox-dark-hard',
  'kanagawa': 'kanagawa-wave',
  'one-dark': 'one-dark-pro',
}

export function migrateThemeId(id: string | undefined): ThemeId {
  if (id !== undefined && id in THEMES) return id as ThemeId
  if (id !== undefined) {
    const alias = LEGACY_THEME_ALIASES[id]
    if (alias !== undefined) return alias
  }
  return 'aimux'
}

export const themes = {
  /**
   * Palette shortcut. Clones `base`'s Theme and patches a few VSCode color keys
   * in `colors`. Token settings inherit from the base unchanged.
   */
  define(name: string, base: ThemeId, overrides: Partial<ThemeColorMap>): NamedThemeDefinition {
    return { base, colors: overrides, name }
  },
  /**
   * Lower-level, unnamed variant of `define`. Prefer `define` for config entries.
   */
  extend(base: ThemeId, overrides: Partial<ThemeColorMap>): ThemeDefinition {
    return { base, colors: overrides }
  },
  /**
   * Identity passthrough for a full raw Shiki theme. Use this to drop a VSCode
   * theme JSON verbatim into aimux config.
   */
  full(theme: NamedTheme): NamedTheme {
    return theme
  },
}
