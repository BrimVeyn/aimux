import { type Theme, type ThemeId, THEMES } from './themes'

const DEFAULT = THEMES['aimux']
if (!DEFAULT) throw new Error('default theme missing')

// Mutable theme singleton. Components access `theme.colors['editor.foreground']`
// directly. On `applyTheme(id)` the colors map is replaced in place so live
// imports keep pointing at the current palette.
export const theme: Theme = {
  bg: DEFAULT.bg,
  colors: { ...DEFAULT.colors },
  displayName: DEFAULT.displayName,
  fg: DEFAULT.fg,
  name: DEFAULT.name,
  settings: DEFAULT.settings,
  type: DEFAULT.type,
}

export function applyTheme(id: ThemeId): void {
  const entry = THEMES[id]
  if (!entry) return
  for (const key of Object.keys(theme.colors)) delete theme.colors[key]
  Object.assign(theme.colors, entry.colors)
  theme.name = entry.name
  theme.displayName = entry.displayName
  theme.type = entry.type
  theme.fg = entry.fg
  theme.bg = entry.bg
  theme.settings = entry.settings
}
