import type { BundledTheme } from 'shiki'

import {
  AIMUX_COLOR_KEYS,
  type AimuxColorKey,
  type NamedTheme,
  type NamedThemeDefinition,
  type Theme,
  type ThemeColorMap,
  type ThemeSettings,
  type ThemeTokenRule,
} from '@brimveyn/aimux-config'

import { HOUSE_THEME_IDS, HOUSE_THEMES } from './house-themes'
import { GENERATED_THEME_IDS, GENERATED_THEMES } from './themes.generated'

export type {
  AimuxColorKey,
  NamedTheme,
  NamedThemeDefinition,
  Theme,
  ThemeColorMap,
  ThemeSettings,
  ThemeTokenRule,
}
export { AIMUX_COLOR_KEYS }

export type ThemeId = BundledTheme | (string & {})

export const THEMES: Record<string, Theme> = { ...GENERATED_THEMES, ...HOUSE_THEMES }
export const THEME_IDS: ThemeId[] = [...GENERATED_THEME_IDS, ...HOUSE_THEME_IDS]

const DEFAULT_THEME_ID: ThemeId = 'aimux'

/**
 * Merge user-declared themes into the registry. Themes declared via
 * `themes.full(...)` arrive as complete `NamedTheme` objects; themes declared
 * via `themes.define(...)` arrive as `NamedThemeDefinition` (partial overrides
 * over a base) and are expanded here.
 */
export function registerUserThemes(
  defs: Record<string, NamedTheme | NamedThemeDefinition> | undefined
): void {
  if (!defs) return
  const fallback = THEMES[DEFAULT_THEME_ID]
  if (!fallback) return
  for (const [id, def] of Object.entries(defs)) {
    THEMES[id] = isFullTheme(def) ? def : expandDefinition(id, def, fallback)
    if (!THEME_IDS.includes(id)) THEME_IDS.push(id)
  }
}

function isFullTheme(def: NamedTheme | NamedThemeDefinition): def is NamedTheme {
  return 'settings' in def && Array.isArray((def as Theme).settings)
}

function expandDefinition(id: string, def: NamedThemeDefinition, fallback: Theme): Theme {
  const base = def.base ? (THEMES[def.base] ?? fallback) : fallback
  const colors: ThemeColorMap = { ...base.colors }
  for (const [k, v] of Object.entries(def.colors ?? {})) {
    if (typeof v === 'string') colors[k] = v
  }
  return {
    ...base,
    colors,
    displayName: def.name,
    name: id,
  }
}

export function isKnownThemeId(id: string): boolean {
  return id in THEMES
}
