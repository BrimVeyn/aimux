import type { ProjectRecord } from '../state/types'
import type { SettingRow } from './types'

import { withAllExpanded } from './plugin-drawers'
import { sectionRows, settingSections } from './sections'

export interface SettingSearchHit {
  row: SettingRow
  sectionId: string
  sectionLabel: string
  /**
   * Position in the screen's list — counted across every section, matches or
   * not, because the screen is one list and that is what its cursor holds. So a
   * search result can be jumped to with the index it already carries.
   */
  rowIndex: number
}

/**
 * Every setting the query matches, across every section. With no query it is
 * the screen's own list, which is why both go through here: one filter, so the
 * list you search and the list you scroll can never disagree.
 *
 * Shared with `getModalOptionCount` too, so the picker and the reducer that
 * moves its cursor count the same list.
 */
export function filterSettingRows(
  projects: readonly ProjectRecord[],
  query: string | null
): SettingSearchHit[] {
  if (query !== null) return withAllExpanded(() => collectSettingRows(projects, query))
  return collectSettingRows(projects, query)
}

function collectSettingRows(
  projects: readonly ProjectRecord[],
  query: string | null
): SettingSearchHit[] {
  const needle = (query ?? '').trim().toLowerCase()
  const hits: SettingSearchHit[] = []
  let rowIndex = -1

  for (const section of settingSections()) {
    const rows = sectionRows(section, projects)
    for (const row of rows) {
      rowIndex++
      // The id is in the haystack deliberately: it is the key in `aimux.json`, so
      // someone who saw it in that file can search for it.
      const haystack = `${row.label} ${row.description ?? ''} ${row.id} ${section.label}`
      if (needle !== '' && !haystack.toLowerCase().includes(needle)) continue
      hits.push({ row, rowIndex, sectionId: section.id, sectionLabel: section.label })
    }
  }

  return hits
}
