import { THEME_IDS, type ThemeId, THEMES } from './themes'

export function filterThemeIds(filter: string | null): ThemeId[] {
  if (!filter) return THEME_IDS
  const needle = filter.toLowerCase()
  return THEME_IDS.filter((id) => {
    const name = THEMES[id].name.toLowerCase()
    return id.toLowerCase().includes(needle) || name.includes(needle)
  })
}
