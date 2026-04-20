import type { AimuxTheme, ThemeId } from './types'

import { HOUSE_THEME_IDS, HOUSE_THEMES } from './house-themes'
import { OPENCODE_THEME_IDS, OPENCODE_THEMES } from './themes/opencode'

export const THEMES: Record<string, AimuxTheme> = { ...HOUSE_THEMES, ...OPENCODE_THEMES }
export const THEME_IDS: ThemeId[] = [...HOUSE_THEME_IDS, ...OPENCODE_THEME_IDS]

const DEFAULT_THEME_ID: ThemeId = 'aimux-dark'

const LEGACY_MODE_HINTS: Record<string, ThemeId> = {
  'aimux': 'aimux-dark',
  'aimux-dark': 'aimux-dark',
  'aimux-light': 'aimux-light',
}

/**
 * Migrate a legacy persisted theme id (anything from the old wide registry)
 * to the new light/dark identifier. Anything we don't recognize lands on the
 * dark default — modes are the only knob now.
 */
export function migrateThemeId(id: string | undefined): ThemeId {
  if (id === undefined) return DEFAULT_THEME_ID
  if (id in THEMES) return id as ThemeId
  return LEGACY_MODE_HINTS[id] ?? DEFAULT_THEME_ID
}

export function isKnownThemeId(id: string): id is ThemeId {
  return id in THEMES
}
