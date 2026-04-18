import type { NamedThemeDefinition, ThemeColors, ThemeDefinition, ThemeId } from './types'

import { GENERATED_THEME_IDS, GENERATED_THEMES } from './themes.generated'

export const THEMES = GENERATED_THEMES
export const THEME_IDS = GENERATED_THEME_IDS

const LEGACY_THEME_ALIASES: Record<string, ThemeId> = {
  'aimux': 'catppuccin-mocha',
  'dracula-at-night': 'dracula',
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
  return 'catppuccin-mocha'
}

export const themes = {
  define(name: string, base: ThemeId, overrides: Partial<ThemeColors>): NamedThemeDefinition {
    return { base, colors: overrides, name }
  },
  extend(base: ThemeId, overrides: Partial<ThemeColors>): ThemeDefinition {
    return { base, colors: overrides }
  },
}
