import { THEME_IDS, type ThemeId } from './themes'

export function themeDisplayName(id: ThemeId): string {
  return id
    .split(/[-_]/)
    .map((p) => (p.length > 0 ? (p[0] ?? '').toUpperCase() + p.slice(1) : p))
    .join(' ')
}

export function filterThemeIds(filter: string | null): ThemeId[] {
  if (!(filter != null && filter !== '')) return THEME_IDS
  const needle = filter.toLowerCase()
  return THEME_IDS.filter((id) => {
    return id.toLowerCase().includes(needle) || themeDisplayName(id).toLowerCase().includes(needle)
  })
}
