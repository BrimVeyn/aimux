import type { NamedThemeDefinition } from '@brimveyn/aimux-config'
import type { BundledTheme } from 'shiki'

import { GENERATED_THEME_IDS, GENERATED_THEMES } from './themes.generated'

export interface ThemeColors {
  background: string
  panel: string
  panelMuted: string
  panelHighlight: string
  overlay: string
  border: string
  borderActive: string
  text: string
  textMuted: string
  accent: string
  accentAlt: string
  warning: string
  danger: string
  success: string
  dim: string
  diffAddBg: string
  diffRemoveBg: string
}

export type ThemeId = BundledTheme | (string & {})

export interface ThemeEntry {
  colors: ThemeColors
  name: string
  type: 'dark' | 'light'
}

export const THEMES: Record<string, ThemeEntry> = { ...GENERATED_THEMES }
export const THEME_IDS: ThemeId[] = [...GENERATED_THEME_IDS]

const DEFAULT_THEME_ID: ThemeId = 'catppuccin-mocha'

export function registerUserThemes(defs: Record<string, NamedThemeDefinition>): void {
  const fallback = THEMES[DEFAULT_THEME_ID]
  if (!fallback) return
  for (const [id, def] of Object.entries(defs)) {
    const base = def.base ? THEMES[def.base] : undefined
    const baseColors = base?.colors ?? fallback.colors
    THEMES[id] = {
      colors: { ...baseColors, ...def.colors },
      name: def.name,
      type: base?.type ?? 'dark',
    }
    if (!THEME_IDS.includes(id)) THEME_IDS.push(id)
  }
}

export function isKnownThemeId(id: string): boolean {
  return id in THEMES
}
