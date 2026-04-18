import { type ThemeColors, type ThemeId, THEMES } from './themes'

const DEFAULT = THEMES['aimux']
if (!DEFAULT) throw new Error('default theme missing')

export const theme: ThemeColors = { ...DEFAULT.colors }

export function applyTheme(id: ThemeId): void {
  const entry = THEMES[id]
  if (!entry) return
  Object.assign(theme, entry.colors)
}
