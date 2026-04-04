import type { AppAction, AppState } from '../types'

import { filterSessions } from '../selectors'
import { restoreWorkspaceState } from '../session-persistence'

const CLOSED_MODAL = {
  editBuffer: null,
  selectedIndex: 0,
  sessionTargetId: null,
  type: null,
} as const

export function reduceSessionState(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'load-session': {
      const snapshot =
        action.workspaceSnapshot ??
        state.sessions.find((entry) => entry.id === action.sessionId)?.workspaceSnapshot
      return {
        ...state,
        ...restoreWorkspaceState(state, snapshot),
        currentSessionId: action.sessionId,
        focusMode: 'navigation',
        modal: CLOSED_MODAL,
        sessions: state.sessions.map((entry) =>
          entry.id === action.sessionId
            ? {
                ...entry,
                lastOpenedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : entry
        ),
      }
    }
    case 'set-sessions':
      return { ...state, sessions: action.sessions }
    case 'create-session-record':
      return {
        ...state,
        currentSessionId: action.session.id,
        focusMode: 'navigation',
        modal: CLOSED_MODAL,
        sessions: [...state.sessions, action.session],
      }
    case 'rename-session-record':
      return {
        ...state,
        focusMode: 'modal',
        modal: {
          editBuffer: null,
          selectedIndex: state.modal.selectedIndex,
          sessionTargetId: null,
          type: 'session-picker',
        },
        sessions: state.sessions.map((session) =>
          session.id === action.sessionId
            ? { ...session, name: action.name, updatedAt: new Date().toISOString() }
            : session
        ),
      }
    case 'delete-session-record': {
      const newSessions = state.sessions.filter((session) => session.id !== action.sessionId)
      const filteredNew = filterSessions(newSessions, state.modal.editBuffer)
      const maxIndex = filteredNew.length
      const clampedIndex = Math.min(state.modal.selectedIndex, maxIndex)
      return {
        ...state,
        activeTabId: action.sessionId === state.currentSessionId ? null : state.activeTabId,
        currentSessionId:
          action.sessionId === state.currentSessionId ? null : state.currentSessionId,
        focusMode: 'modal',
        modal: {
          editBuffer: null,
          selectedIndex: clampedIndex,
          sessionTargetId: null,
          type: 'session-picker',
        },
        sessions: newSessions,
        tabs: action.sessionId === state.currentSessionId ? [] : state.tabs,
      }
    }
    default:
      return null
  }
}
