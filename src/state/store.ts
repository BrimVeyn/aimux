import type { AppAction, AppState, SessionRecord, SnippetRecord } from './types'

import { emptyModal, reduceModalState } from './reducers/modal-state'
import { reduceSessionState } from './reducers/session-state'
import { reduceTabState } from './reducers/tab-state'
import { reduceUIState } from './reducers/ui-state'
import { filterSnippets } from './selectors'

const DEFAULT_SIDEBAR_WIDTH = 28
const DEFAULT_SIDEBAR_MIN_WIDTH = 18
const DEFAULT_SIDEBAR_MAX_WIDTH = 42
const DEFAULT_TERMINAL_COLS = 80
const DEFAULT_TERMINAL_ROWS = 24

export function createInitialState(
  customCommands: Record<string, string> = {},
  sessions: SessionRecord[] = [],
  snippets: SnippetRecord[] = [],
  showSessionPicker = false
): AppState {
  return {
    activeTabId: null,
    currentSessionId: null,
    customCommands,
    focusMode: showSessionPicker ? 'modal' : 'navigation',
    layout: {
      terminalCols: DEFAULT_TERMINAL_COLS,
      terminalRows: DEFAULT_TERMINAL_ROWS,
    },
    layoutTrees: {},
    modal: showSessionPicker
      ? { editBuffer: null, selectedIndex: 0, sessionTargetId: null, type: 'session-picker' }
      : emptyModal(),
    sessions,
    sidebar: {
      maxWidth: DEFAULT_SIDEBAR_MAX_WIDTH,
      minWidth: DEFAULT_SIDEBAR_MIN_WIDTH,
      visible: true,
      width: DEFAULT_SIDEBAR_WIDTH,
    },
    snippets,
    tabGroupMap: {},
    tabs: [],
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
        modal: {
          ...state.modal,
          selectedIndex: Math.min(state.modal.selectedIndex, maxIndex),
        },
        snippets: newSnippets,
      }
    }
    default:
      return state
  }
}
