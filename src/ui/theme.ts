import { type ThemeColors, type ThemeId, THEMES } from './themes'

export const theme: ThemeColors = { ...THEMES.aimux.colors }

type ThemeListener = () => void
const themeListeners = new Set<ThemeListener>()

export function onThemeChange(listener: ThemeListener): () => void {
  themeListeners.add(listener)
  return () => themeListeners.delete(listener)
}

export function applyTheme(id: ThemeId): void {
  const entry = THEMES[id]
  if (!entry) return
  Object.assign(theme, entry.colors)
  for (const listener of themeListeners) listener()
}
