import type { AppAction } from '../actions'
import type { AppState, StatsUIState } from '../types'

import { STATS_PAGES } from '../stats-pages'

export function emptyStatsUI(): StatsUIState {
  return { pageIndex: 0, scrollTop: 0 }
}

function withStats(state: AppState, patch: Partial<StatsUIState>): AppState {
  return { ...state, stats: { ...state.stats, ...patch } }
}

function clamp(value: number, max: number): number {
  if (max < 0) return 0
  return Math.max(0, Math.min(max, value))
}

export function reduceStatsState(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'enter-stats':
      if (state.focusMode === 'stats') return state
      // The page is remembered across a close/open within the session; the
      // scroll inside it is not — reopening lands you at the top of it.
      return { ...state, focusMode: 'stats', stats: { ...state.stats, scrollTop: 0 } }
    case 'exit-stats':
      if (state.focusMode !== 'stats') return state
      return { ...state, focusMode: 'navigation' }
    case 'stats-move-page': {
      const pageIndex = clamp(state.stats.pageIndex + action.delta, STATS_PAGES.length - 1)
      if (pageIndex === state.stats.pageIndex) return state
      // A new page is a different length; carrying the old offset into it lands
      // the viewport somewhere the user never scrolled to.
      return withStats(state, { pageIndex, scrollTop: 0 })
    }
    case 'stats-select-page': {
      const pageIndex = clamp(action.pageIndex, STATS_PAGES.length - 1)
      if (pageIndex === state.stats.pageIndex) return state
      return withStats(state, { pageIndex, scrollTop: 0 })
    }
    case 'stats-scroll':
      // No upper clamp here: the reducer does not know how tall the rendered
      // page is. The scrollbox is what actually bounds it, and the view feeds
      // the clamped value back.
      return withStats(state, { scrollTop: Math.max(0, state.stats.scrollTop + action.delta) })
    default:
      return null
  }
}
