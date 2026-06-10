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
      const restored = restoreWorkspaceState(state, snapshot, {
        forceDisconnected: action.forceDisconnected ?? true,
      })
      // The session's activeWorktreeId may have been patched right before
      // this load (e.g. the cross-workspace branch of handleCycleSidebarItem
      // sets it to the worktree the user just clicked). The snapshot's
      // activeTabId still reflects the *last* worktree they were on, so
      // honor the patched worktree by filtering the restored tab list.
      const loadedSession = state.sessions.find((entry) => entry.id === action.sessionId)
      const visible = filterTabsForActiveWorktree(restored.tabs, loadedSession)
      // Prefer the snapshot's tab; if it isn't visible under the active
      // worktree (e.g. a multi-worktree session restored onto a different
      // worktree), fall back to the last tab we viewed in that worktree,
      // then to the first visible tab.
      const rememberedForWorktree =
        loadedSession?.activeWorktreeId != null && loadedSession.activeWorktreeId !== ''
          ? state.lastActiveTabByWorktree[loadedSession.activeWorktreeId]
          : undefined
      const snapshotTabVisible =
        restored.activeTabId != null &&
        restored.activeTabId !== '' &&
        visible.some((t) => t.id === restored.activeTabId)
      const rememberedTabVisible =
        rememberedForWorktree != null &&
        rememberedForWorktree !== '' &&
        visible.some((t) => t.id === rememberedForWorktree)
      const fallbackTabId = rememberedTabVisible ? rememberedForWorktree : (visible[0]?.id ?? null)
      const activeTabId = snapshotTabVisible ? restored.activeTabId : fallbackTabId
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
      // Remember the tab we're leaving so coming back to this worktree later
      // restores it instead of snapping to the first tab. Keyed by the
      // worktree we're departing (the current session's active one).
      const leavingSession = state.sessions.find((s) => s.id === action.sessionId)
      const leavingWorktreeId = leavingSession?.activeWorktreeId
      const lastActiveTabByWorktree =
        action.sessionId === state.currentSessionId &&
        leavingWorktreeId != null &&
        leavingWorktreeId !== '' &&
        state.activeTabId != null &&
        state.activeTabId !== ''
          ? { ...state.lastActiveTabByWorktree, [leavingWorktreeId]: state.activeTabId }
          : state.lastActiveTabByWorktree
      // Changing the worktree of a non-current session has no effect on
      // which tab the user is looking at — leave activeTabId alone.
      if (action.sessionId !== state.currentSessionId) {
        return { ...state, lastActiveTabByWorktree, sessions }
      }
      // For the current session: if the existing activeTabId belongs to
      // the new worktree, keep it. Otherwise restore the last tab we viewed
      // in that worktree, falling back to the first visible tab (or clearing
      // it if the worktree is empty — the pane then renders the "this
      // worktree has no tabs" placeholder).
      const updated = sessions.find((s) => s.id === action.sessionId)
      const visible = filterTabsForActiveWorktree(state.tabs, updated)
      const currentStillVisible =
        state.activeTabId != null &&
        state.activeTabId !== '' &&
        visible.some((t) => t.id === state.activeTabId)
      if (currentStillVisible) {
        return { ...state, lastActiveTabByWorktree, sessions }
      }
      const remembered = lastActiveTabByWorktree[action.worktreeId]
      const nextActiveTabId =
        remembered != null && remembered !== '' && visible.some((t) => t.id === remembered)
          ? remembered
          : (visible[0]?.id ?? null)
      return { ...state, activeTabId: nextActiveTabId, lastActiveTabByWorktree, sessions }
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
