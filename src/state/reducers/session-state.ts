import type { AppAction, AppState } from '../types'

import { filterSessions } from '../selectors'
import { restoreWorkspaceState } from '../session-persistence'
import { withActiveWorktree } from '../session-worktrees'

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
        sessions: state.sessions.map((session) =>
          session.id === action.sessionId
            ? { ...session, name: action.name, updatedAt: new Date().toISOString() }
            : session
        ),
      }
    case 'delete-session-record': {
      const deletingCurrent = action.sessionId === state.currentSessionId
      const newSessions = state.sessions.filter((session) => session.id !== action.sessionId)
      const nextStatuses = { ...state.sessionStatuses }
      delete nextStatuses[action.sessionId]
      if (action.openSessionPicker === true) {
        const filteredNew = filterSessions(newSessions, state.modal.editBuffer)
        const maxIndex = filteredNew.length
        const clampedIndex = Math.min(state.modal.selectedIndex, maxIndex)
        return {
          ...state,
          activeTabId: deletingCurrent ? null : state.activeTabId,
          currentSessionId: deletingCurrent ? null : state.currentSessionId,
          focusMode: 'modal',
          modal: {
            editBuffer: null,
            selectedIndex: clampedIndex,
            sessionTargetId: null,
            type: 'session-picker',
          },
          sessions: newSessions,
          sessionStatuses: nextStatuses,
          tabs: deletingCurrent ? [] : state.tabs,
        }
      }
      return {
        ...state,
        activeTabId: deletingCurrent ? null : state.activeTabId,
        currentSessionId: deletingCurrent ? null : state.currentSessionId,
        focusMode: deletingCurrent ? 'navigation' : state.focusMode,
        modal: deletingCurrent ? CLOSED_MODAL : state.modal,
        sessions: newSessions,
        sessionStatuses: nextStatuses,
        tabs: deletingCurrent ? [] : state.tabs,
      }
    }
    case 'reorder-sessions': {
      const byId = new Map(state.sessions.map((s) => [s.id, s]))
      const ordered: typeof state.sessions = []
      let idx = 0
      for (const id of action.orderedIds) {
        const s = byId.get(id)
        if (s) {
          ordered.push({ ...s, order: idx })
          byId.delete(id)
        }
        idx++
      }
      let nextOrder = ordered.length
      for (const s of byId.values()) {
        ordered.push({ ...s, order: nextOrder++ })
      }
      return { ...state, sessions: ordered }
    }
    case 'set-session-status': {
      const prev = state.sessionStatuses[action.sessionId]
      if (
        prev !== undefined &&
        prev.working === action.status.working &&
        prev.waiting === action.status.waiting
      ) {
        return state
      }
      return {
        ...state,
        sessionStatuses: { ...state.sessionStatuses, [action.sessionId]: action.status },
      }
    }
    case 'add-worktree-record':
      return {
        ...state,
        sessions: state.sessions.map((session) => {
          if (session.id !== action.sessionId) return session
          const next = {
            ...session,
            activeWorktreeId:
              action.activate === true ? action.worktree.id : session.activeWorktreeId,
            projectPath: action.activate === true ? action.worktree.path : session.projectPath,
            updatedAt: new Date().toISOString(),
            worktrees: [...(session.worktrees ?? []), action.worktree],
          }
          return next.activeWorktreeId != null && next.activeWorktreeId !== ''
            ? next
            : withActiveWorktree(next, action.worktree.id)
        }),
      }
    case 'remove-worktree-record':
      return {
        ...state,
        sessions: state.sessions.map((session) => {
          if (session.id !== action.sessionId) return session
          const remaining = (session.worktrees ?? []).filter((w) => w.id !== action.worktreeId)
          if (remaining.length === 0) return session
          if (session.activeWorktreeId !== action.worktreeId) {
            return { ...session, updatedAt: new Date().toISOString(), worktrees: remaining }
          }
          return withActiveWorktree(
            { ...session, activeWorktreeId: remaining[0]?.id, worktrees: remaining },
            remaining[0]?.id ?? ''
          )
        }),
      }
    case 'set-active-worktree':
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.sessionId ? withActiveWorktree(session, action.worktreeId) : session
        ),
      }
    case 'update-worktree-record':
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.sessionId
            ? {
                ...session,
                updatedAt: new Date().toISOString(),
                worktrees: session.worktrees?.map((worktree) =>
                  worktree.id === action.worktreeId
                    ? { ...worktree, ...action.patch, updatedAt: new Date().toISOString() }
                    : worktree
                ),
              }
            : session
        ),
      }
    default:
      return null
  }
}
