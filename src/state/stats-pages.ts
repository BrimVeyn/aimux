/**
 * The stats screen's pages, in nav order.
 *
 * Lives in the state layer rather than beside the view because the reducer is
 * what clamps the page cursor: the list of pages is a bound, and a bound the
 * reducer cannot see is a bound it cannot enforce.
 *
 * Three pages, not one per topic. Quotas, token cost and the calendar all answer
 * "how much am I using this", so they share a page; everything else earns its
 * own by being a different question.
 *
 * Records used to be a fourth. A page of eight one-line trivia rows was mostly
 * empty, and every row was a record *of* something another page already covers —
 * so each one now closes the page whose data it comes from.
 */

export interface StatsPage {
  glyph: string
  id: StatsPageId
  label: string
}

/**
 * Widened with `(string & {})` because a plugin can contribute a page and its
 * id is not knowable here. The literal half survives, so a `switch` over the
 * built-in pages still autocompletes.
 */
export type StatsPageId = 'aimux' | 'projects' | 'usage' | (string & {})

export const BUILTIN_STATS_PAGES: readonly StatsPage[] = [
  { glyph: '\u{25D4}', id: 'usage', label: 'Usage' },
  { glyph: '\u{2632}', id: 'projects', label: 'Projects' },
  { glyph: '\u{2318}', id: 'aimux', label: 'aimux' },
]

const pluginPages = new Map<string, StatsPage>()
const listeners = new Set<() => void>()

export function onStatsPagesChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(): void {
  const current = [...listeners]
  for (const listener of current) listener()
}

/**
 * Registers a page. It lands after the built-ins, so the page a user navigates
 * to by muscle memory keeps its index when they install something.
 *
 * Returns the disposer the plugin's fiber holds. The reducer clamps the page
 * cursor against `statsPages().length`, so a page vanishing mid-session moves
 * the cursor rather than stranding it past the end.
 */
export function registerStatsPage(page: StatsPage): () => void {
  pluginPages.set(page.id, page)
  notify()
  return () => {
    if (pluginPages.get(page.id) === page) pluginPages.delete(page.id)
    notify()
  }
}

/** Test seam. Never called by the app. */
export function clearStatsPages(): void {
  pluginPages.clear()
  notify()
}

/**
 * The pages in nav order. Read fresh on every call — the reducer clamps the
 * cursor with it, and a bound read once at import is a bound that stops being
 * true the moment a plugin loads.
 */
export function statsPages(): readonly StatsPage[] {
  if (pluginPages.size === 0) return BUILTIN_STATS_PAGES
  return [...BUILTIN_STATS_PAGES, ...pluginPages.values()]
}

export function statsPageAt(index: number): StatsPage {
  const pages = statsPages()
  return pages[index] ?? pages[0] ?? { glyph: '\u{25D4}', id: 'usage', label: 'Usage' }
}

/** What a plugin page renders, keyed by page id. */
const renderers = new Map<string, () => unknown>()

export function registerStatsPageRenderer(id: string, render: () => unknown): () => void {
  renderers.set(id, render)
  return () => {
    if (renderers.get(id) === render) renderers.delete(id)
  }
}

export function getStatsPageRenderer(id: string): (() => unknown) | undefined {
  return renderers.get(id)
}
