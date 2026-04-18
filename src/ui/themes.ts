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

export type ThemeId = BundledTheme

export const THEMES = GENERATED_THEMES
export const THEME_IDS = GENERATED_THEME_IDS
