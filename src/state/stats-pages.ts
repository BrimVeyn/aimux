/**
 * The stats screen's pages, in nav order.
 *
 * Lives in the state layer rather than beside the view because the reducer is
 * what clamps the page cursor: the list of pages is a bound, and a bound the
 * reducer cannot see is a bound it cannot enforce.
 *
 * Four pages, not one per topic. Quotas, token cost and the calendar all answer
 * "how much am I using this", so they share a page; everything else earns its
 * own by being a different question.
 */

export interface StatsPage {
  glyph: string
  id: StatsPageId
  label: string
}

export type StatsPageId = 'aimux' | 'projects' | 'records' | 'usage'

export const STATS_PAGES: readonly StatsPage[] = [
  { glyph: '\u{25D4}', id: 'usage', label: 'Usage' },
  { glyph: '\u{2632}', id: 'projects', label: 'Projects' },
  { glyph: '\u{2318}', id: 'aimux', label: 'aimux' },
  { glyph: '\u{2605}', id: 'records', label: 'Records' },
]

export function statsPageAt(index: number): StatsPage {
  return STATS_PAGES[index] ?? STATS_PAGES[0] ?? { glyph: '\u{25D4}', id: 'usage', label: 'Usage' }
}
