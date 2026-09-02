import { type ThemeId, themeIds } from './themes'

export function themeDisplayName(id: ThemeId): string {
  return id
    .split(/[-_]/)
    .map((p) => (p.length > 0 ? (p[0] ?? '').toUpperCase() + p.slice(1) : p))
    .join(' ')
}

export function filterThemeIds(filter: string | null): ThemeId[] {
  // Read per call: a theme dropped into `<profile>/themes/` or shipped by a
  // plugin has to show up in the picker without a restart.
  const ids = themeIds()
  if (!(filter != null && filter !== '')) return ids
  const needle = filter.toLowerCase()
  return ids.filter((id) => {
    return id.toLowerCase().includes(needle) || themeDisplayName(id).toLowerCase().includes(needle)
  })
}
