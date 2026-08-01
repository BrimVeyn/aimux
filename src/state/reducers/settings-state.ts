import type { AppAction } from '../actions'
import type { AppState, SettingsUIState } from '../types'

import { DEFAULT_SECTION_ID, getSectionRows, SETTING_SECTIONS } from '../../settings/sections'

export function emptySettingsUI(): SettingsUIState {
  return { pane: 'nav', rowIndex: 0, sectionId: DEFAULT_SECTION_ID }
}

function clamp(value: number, max: number): number {
  if (max < 0) return 0
  return Math.max(0, Math.min(max, value))
}

function withSettings(state: AppState, patch: Partial<SettingsUIState>): AppState {
  return { ...state, settings: { ...state.settings, ...patch } }
}

function moveSelection(state: AppState, delta: -1 | 1): AppState {
  const { pane, rowIndex, sectionId } = state.settings

  if (pane === 'nav') {
    const index = SETTING_SECTIONS.findIndex((section) => section.id === sectionId)
    const next = clamp((index === -1 ? 0 : index) + delta, SETTING_SECTIONS.length - 1)
    const nextId = SETTING_SECTIONS[next]?.id
    if (nextId == null || nextId === sectionId) return state
    // A new section has its own rows, so the row cursor from the old one means
    // nothing here.
    return withSettings(state, { rowIndex: 0, sectionId: nextId })
  }

  return withSettings(state, {
    rowIndex: clamp(rowIndex + delta, getSectionRows(sectionId).length - 1),
  })
}

export function reduceSettingsState(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'enter-settings':
      if (state.focusMode === 'settings') return state
      // The section is remembered across a close/open within the session; the
      // cursor inside it is not — reopening lands you at the top of it.
      return {
        ...state,
        focusMode: 'settings',
        settings: { ...state.settings, pane: 'nav', rowIndex: 0 },
      }
    case 'exit-settings':
      if (state.focusMode !== 'settings') return state
      return { ...state, focusMode: 'navigation' }
    case 'settings-focus-pane': {
      // A section with no rows has nothing to focus, so `l` stays put rather
      // than parking the cursor in an empty column.
      if (action.pane === 'rows' && getSectionRows(state.settings.sectionId).length === 0) {
        return state
      }
      return withSettings(state, { pane: action.pane })
    }
    case 'settings-move-selection':
      return moveSelection(state, action.delta)
    case 'settings-select-section':
      if (action.sectionId === state.settings.sectionId) {
        return withSettings(state, { pane: 'nav' })
      }
      return withSettings(state, { pane: 'nav', rowIndex: 0, sectionId: action.sectionId })
    case 'settings-select-row':
      return withSettings(state, {
        pane: 'rows',
        rowIndex: clamp(action.rowIndex, getSectionRows(state.settings.sectionId).length - 1),
      })
    default:
      return null
  }
}
