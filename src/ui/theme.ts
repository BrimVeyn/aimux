import { type ThemeColors, type ThemeId, THEMES } from './themes'

export const theme: ThemeColors = { ...THEMES['catppuccin-mocha'].colors }

export function applyTheme(id: ThemeId): void {
  const entry = THEMES[id]
  if (!entry) return
  Object.assign(theme, entry.colors)
}
