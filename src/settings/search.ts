import type { ProjectRecord } from '../state/types'
import type { SettingRow } from './types'

import { sectionRows, SETTING_SECTIONS } from './sections'

export interface SettingSearchHit {
  row: SettingRow
  sectionId: string
  sectionLabel: string
  /** Index within its own section, which is what the cursor is expressed in. */
  rowIndex: number
}

/**
 * Every setting the query matches, across every section. Ten sections is more
 * than anyone will scan, and this is the only list in the app you could not type
 * into to find something.
 *
 * Shared with `getModalOptionCount` so the picker and the reducer that moves its
 * cursor count the same list — two filters would drift the moment one changed.
 */
export function filterSettingRows(
  projects: readonly ProjectRecord[],
  query: string | null
): SettingSearchHit[] {
  const needle = (query ?? '').trim().toLowerCase()
  const hits: SettingSearchHit[] = []

  for (const section of SETTING_SECTIONS) {
    const rows = sectionRows(section, projects)
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex]
      if (!row) continue
      // The id is in the haystack deliberately: it is the key in `aimux.json`, so
      // someone who saw it in that file can search for it.
      const haystack = `${row.label} ${row.description ?? ''} ${row.id} ${section.label}`
      if (needle !== '' && !haystack.toLowerCase().includes(needle)) continue
      hits.push({ row, rowIndex, sectionId: section.id, sectionLabel: section.label })
    }
  }

  return hits
}
