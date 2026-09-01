import type { AppAction } from '../actions'
import type { AppState, SettingsUIState } from '../types'

import { sectionStartIndexes, totalRowCount } from '../../settings/sections'

export function emptySettingsUI(): SettingsUIState {
  return { rowIndex: 0 }
}

function clamp(value: number, max: number): number {
  if (max < 0) return 0
  return Math.max(0, Math.min(max, value))
}

function withRowIndex(state: AppState, rowIndex: number): AppState {
  return {
    ...state,
    settings: { ...state.settings, rowIndex: clamp(rowIndex, totalRowCount(state.projects) - 1) },
  }
}

/**
 * The first row of the next section down, or of the one the cursor is already
 * inside when going up and it is not on its first row — the paragraph motion `}`
 * and `{` are named after, rather than a plain "section ± 1" that would skip the
 * heading you were standing under.
 */
function jumpSection(state: AppState, delta: -1 | 1): AppState {
  const starts = sectionStartIndexes(state.projects)
  const current = state.settings.rowIndex
  const next =
    delta === 1
      ? starts.find((start) => start > current)
      : starts.filter((start) => start < current).at(-1)
  if (next === undefined) return state
  return withRowIndex(state, next)
}

export function reduceSettingsState(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'enter-settings':
      if (state.focusMode === 'settings') return state
      // Reopening lands at the top: the list is one column now, so the top of it
      // is where the search and the first section both are.
      return { ...state, focusMode: 'settings', settings: { ...state.settings, rowIndex: 0 } }
    case 'exit-settings':
      if (state.focusMode !== 'settings') return state
      return { ...state, focusMode: 'navigation' }
    case 'settings-move-selection':
      return withRowIndex(state, state.settings.rowIndex + action.delta)
    case 'settings-jump-section':
      return jumpSection(state, action.delta)
    case 'settings-select-row':
      return withRowIndex(state, action.rowIndex)
    default:
      return null
  }
}
