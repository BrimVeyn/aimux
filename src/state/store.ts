import type { AppAction, AppState, SessionRecord, SnippetRecord } from './types'

import { emptyModal } from './reducers/modal-state'
import { reduceModalState } from './reducers/modal-state'
import { reduceSessionState } from './reducers/session-state'
import { reduceTabState } from './reducers/tab-state'
import { reduceUIState } from './reducers/ui-state'
import { filterSnippets } from './selectors'

export function createInitialState(
  customCommands: Record<string, string> = {},
  sessions: SessionRecord[] = [],
  snippets: SnippetRecord[] = [],
  showSessionPicker = false
): AppState {
  return {
    tabs: [],
    activeTabId: null,
    layoutTree: null,
    sessions,
    currentSessionId: null,
    snippets,
    focusMode: showSessionPicker ? 'modal' : 'navigation',
    sidebar: {
      visible: true,
      width: 28,
      minWidth: 18,
      maxWidth: 42,
    },
    modal: showSessionPicker
      ? { type: 'session-picker', selectedIndex: 0, editBuffer: null, sessionTargetId: null }
      : emptyModal(),
    layout: {
      terminalCols: 80,
      terminalRows: 24,
    },
    customCommands,
  }
}

export function appReducer(state: AppState, action: AppAction): AppState {
  const sessionState = reduceSessionState(state, action)
  if (sessionState) return sessionState

  const tabState = reduceTabState(state, action)
  if (tabState) return tabState

  const modalState = reduceModalState(state, action)
  if (modalState) return modalState

  const uiState = reduceUIState(state, action)
  if (uiState) return uiState

  switch (action.type) {
    case 'set-snippets':
      return { ...state, snippets: action.snippets }
    case 'delete-snippet': {
      const newSnippets = state.snippets.filter((s) => s.id !== action.snippetId)
      const filteredNew = filterSnippets(newSnippets, state.modal.editBuffer)
      const maxIndex = Math.max(0, filteredNew.length - 1)
      return {
        ...state,
        snippets: newSnippets,
        modal: {
          ...state.modal,
          selectedIndex: Math.min(state.modal.selectedIndex, maxIndex),
        },
      }
    }
    default:
      return state
  }
}
