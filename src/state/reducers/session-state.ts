import type { AppAction, AppState } from '../types'

import { moveIdToIdPosition, orderSessionsForDisplay } from '../../ui/session-ordering'
import { filterSessions } from '../selectors'
import { restoreWorkspaceState } from '../session-persistence'
import { filterTabsForActiveWorktree, withActiveWorktree } from '../session-worktrees'

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
      const restored = restoreWorkspaceState(state, snapshot)
      // The session's activeWorktreeId may have been patched right before
      // this load (e.g. the cross-workspace branch of handleCycleSidebarItem
      // sets it to the worktree the user just clicked). The snapshot's
      // activeTabId still reflects the *last* worktree they were on, so
      // honor the patched worktree by filtering the restored tab list.
      const loadedSession = state.sessions.find((entry) => entry.id === action.sessionId)
      const visible = filterTabsForActiveWorktree(restored.tabs, loadedSession)
      const activeTabId =
        restored.activeTabId != null &&
        restored.activeTabId !== '' &&
        visible.some((t) => t.id === restored.activeTabId)
          ? restored.activeTabId
          : (visible[0]?.id ?? null)
      return {
        ...state,
        ...restored,
        activeTabId,
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
    case 'reorder-active-session': {
      const currentId = state.currentSessionId
      if (currentId == null || currentId === '') return state
      const ids = orderSessionsForDisplay(state.sessions).map((s) => s.id)
      const from = ids.indexOf(currentId)
      if (from < 0) return state
      const to = from + action.delta
      const targetId = ids[to]
      if (targetId == null) return state
      const nextIds = moveIdToIdPosition(ids, currentId, targetId)
      const byId = new Map(state.sessions.map((s) => [s.id, s]))
      const nextSessions = nextIds.map((id, idx) => {
        const s = byId.get(id)
        return s ? { ...s, order: idx } : s
      })
      const filtered = nextSessions.filter((s): s is NonNullable<typeof s> => s != null)
      if (filtered.length !== state.sessions.length) return state
      return { ...state, sessions: filtered }
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
    case 'set-active-worktree': {
      const sessions = state.sessions.map((session) =>
        session.id === action.sessionId ? withActiveWorktree(session, action.worktreeId) : session
      )
      // Changing the worktree of a non-current session has no effect on
      // which tab the user is looking at — leave activeTabId alone.
      if (action.sessionId !== state.currentSessionId) {
        return { ...state, sessions }
      }
      // For the current session: if the existing activeTabId belongs to
      // the new worktree, keep it. Otherwise hop to the first tab visible
      // under that worktree (or clear it if the worktree is empty — the
      // pane then renders the "this worktree has no tabs" placeholder).
      const updated = sessions.find((s) => s.id === action.sessionId)
      const visible = filterTabsForActiveWorktree(state.tabs, updated)
      const currentStillVisible =
        state.activeTabId != null &&
        state.activeTabId !== '' &&
        visible.some((t) => t.id === state.activeTabId)
      if (currentStillVisible) {
        return { ...state, sessions }
      }
      return { ...state, activeTabId: visible[0]?.id ?? null, sessions }
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
