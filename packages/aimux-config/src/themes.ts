import type {
  NamedTheme,
  NamedThemeDefinition,
  Theme,
  ThemeColorMap,
  ThemeDefinition,
  ThemeId,
  UserThemeInput,
} from './types'

import { HOUSE_THEME_IDS, HOUSE_THEMES } from './house-themes'
import { normalizeTheme } from './normalize-theme'
import { GENERATED_THEME_IDS, GENERATED_THEMES } from './themes/generated'

export const THEMES: Record<string, Theme> = { ...GENERATED_THEMES, ...HOUSE_THEMES }
export const THEME_IDS: ThemeId[] = [...GENERATED_THEME_IDS, ...HOUSE_THEME_IDS]

const DEFAULT_THEME_ID: ThemeId = 'aimux'

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
  return DEFAULT_THEME_ID
}

export function isKnownThemeId(id: string): boolean {
  return id in THEMES
}

function isFullTheme(
  def: NamedTheme | NamedThemeDefinition | UserThemeInput
): def is NamedTheme | UserThemeInput {
  return 'settings' in def || 'fg' in def || 'bg' in def
}

/**
 * Merge user-declared themes into the registry. Both the full and palette
 * shortcut paths run through `normalizeTheme` so every registered theme has
 * all AIMUX_COLOR_KEYS populated — same guarantees as shipped themes.
 */
export function registerUserThemes(
  defs: Record<string, NamedTheme | NamedThemeDefinition | UserThemeInput> | undefined
): void {
  if (!defs) return
  const fallback = THEMES[DEFAULT_THEME_ID]
  if (!fallback) return
  for (const [id, def] of Object.entries(defs)) {
    if (isFullTheme(def)) {
      THEMES[id] = normalizeTheme({ ...def, name: def.name ?? id })
    } else {
      const base = def.base ? (THEMES[def.base] ?? fallback) : fallback
      const colors: Record<string, string> = { ...base.colors }
      for (const [k, v] of Object.entries(def.colors ?? {})) {
        if (typeof v === 'string') colors[k] = v
      }
      THEMES[id] = normalizeTheme({
        bg: base.bg,
        colors,
        displayName: def.name,
        fg: base.fg,
        name: id,
        settings: base.settings,
        type: base.type,
      })
    }
    if (!THEME_IDS.includes(id)) THEME_IDS.push(id)
  }
}

export const themes = {
  /**
   * Palette shortcut. Patches VSCode color keys on top of an existing theme;
   * token settings inherit from the base unchanged.
   */
  define(name: string, base: ThemeId, overrides: Partial<ThemeColorMap>): NamedThemeDefinition {
    return { base, colors: overrides, name }
  },
  /** Unnamed variant of `define`. Prefer `define` in config. */
  extend(base: ThemeId, overrides: Partial<ThemeColorMap>): ThemeDefinition {
    return { base, colors: overrides }
  },
  /**
   * Passthrough for a raw Shiki / VSCode-shape theme. Missing
   * `AIMUX_COLOR_KEYS` are filled at registration via the same fallback chain
   * the shipped themes go through.
   */
  full(theme: UserThemeInput): UserThemeInput {
    return theme
  },
}
