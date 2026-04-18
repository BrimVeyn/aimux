import { THEME_IDS, type ThemeId, THEMES } from './themes'

export function filterThemeIds(filter: string | null): ThemeId[] {
  if (!filter) return THEME_IDS
  const needle = filter.toLowerCase()
  return THEME_IDS.filter((id) => {
    const entry = THEMES[id]
    if (!entry) return false
    return (
      id.toLowerCase().includes(needle) ||
      entry.displayName.toLowerCase().includes(needle) ||
      entry.name.toLowerCase().includes(needle)
    )
  })
}
