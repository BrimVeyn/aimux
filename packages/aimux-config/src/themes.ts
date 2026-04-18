import type { ThemeColors, ThemeDefinition, ThemeId } from './types'

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
  extend(base: ThemeId, overrides: Partial<ThemeColors>): ThemeDefinition {
    const baseTheme = THEMES[base]
    if (!baseTheme) {
      throw new Error(`themes.extend: unknown base theme "${base}"`)
    }
    return {
      base,
      colors: { ...baseTheme.colors, ...overrides },
    }
  },
}
