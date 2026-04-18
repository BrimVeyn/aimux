import type { NamedThemeDefinition, ThemeColors, ThemeDefinition, ThemeId } from './types'

import { HOUSE_THEME_IDS, HOUSE_THEMES } from './house-themes'
import { GENERATED_THEME_IDS, GENERATED_THEMES } from './themes.generated'

export const THEMES: Record<string, { colors: ThemeColors; name: string; type: 'dark' | 'light' }> =
  { ...GENERATED_THEMES, ...HOUSE_THEMES }
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
  define(name: string, base: ThemeId, overrides: Partial<ThemeColors>): NamedThemeDefinition {
    return { base, colors: overrides, name }
  },
  extend(base: ThemeId, overrides: Partial<ThemeColors>): ThemeDefinition {
    return { base, colors: overrides }
  },
}
