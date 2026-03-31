import type { SessionBackend } from '../session-backend/types'
import type { AppAction, AppState, SessionRecord, TabSession } from '../state/types'

import { logInputDebug } from '../debug/input-log'
import { saveSessionCatalog } from '../state/session-catalog'
import { createEmptyWorkspaceSnapshot, serializeWorkspace } from '../state/session-persistence'
import { buildSessionsWithCurrentSnapshot } from '../state/workspace-save'

export function createSessionFromCurrentState(
  state: AppState,
  name: string,
  projectPath?: string
): { session: SessionRecord; sessions: SessionRecord[] } {
  const now = new Date().toISOString()
  const workspaceSnapshot =
    state.currentSessionId || state.tabs.length === 0
      ? createEmptyWorkspaceSnapshot()
      : serializeWorkspace(state)
  const session: SessionRecord = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    projectPath,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    workspaceSnapshot,
  }

  let updatedSessions = state.sessions
  if (state.currentSessionId) {
    const currentSnapshot = serializeWorkspace(state)
    updatedSessions = state.sessions.map((entry) =>
      entry.id === state.currentSessionId
        ? { ...entry, updatedAt: now, workspaceSnapshot: currentSnapshot }
        : entry
    )
  }

  return {
    session,
    sessions: [...updatedSessions, session],
  }
}

export function renameSessionRecords(
  sessions: SessionRecord[],
  sessionId: string,
  name: string
): SessionRecord[] {
  return sessions.map((session) =>
    session.id === sessionId ? { ...session, name, updatedAt: new Date().toISOString() } : session
  )
}

export function switchSessionRecords(state: AppState, session: SessionRecord): SessionRecord[] {
  const sessionsWithSnapshot = buildSessionsWithCurrentSnapshot(
    state.sessions,
    state.currentSessionId,
    state
  )
  return sessionsWithSnapshot.map((entry) =>
    entry.id === session.id ? { ...entry, lastOpenedAt: new Date().toISOString() } : entry
  )
}

export function deleteSessionRecords(
  sessions: SessionRecord[],
  sessionId: string
): SessionRecord[] {
  return sessions.filter((session) => session.id !== sessionId)
}

export function handleCreateSessionEffect(
  state: AppState,
  dispatch: (action: AppAction) => void,
  name: string,
  projectPath?: string
): void {
  const { session, sessions } = createSessionFromCurrentState(state, name, projectPath)
  logInputDebug('app.session.create', {
    sessionId: session.id,
    name,
    fromCurrentWorkspace: !state.currentSessionId && state.tabs.length > 0,
    tabCount: session.workspaceSnapshot?.tabs.length ?? 0,
  })
  saveSessionCatalog(sessions)
  dispatch({ type: 'set-sessions', sessions })
  dispatch({
    type: 'load-session',
    sessionId: session.id,
    workspaceSnapshot: session.workspaceSnapshot,
  })
}

export function handleRenameSessionEffect(
  sessions: SessionRecord[],
  dispatch: (action: AppAction) => void,
  sessionId: string,
  name: string
): void {
  logInputDebug('app.session.rename', { sessionId, name })
  const renamed = renameSessionRecords(sessions, sessionId, name)
  saveSessionCatalog(renamed)
  dispatch({ type: 'rename-session-record', sessionId, name })
}

export function handleSwitchSessionEffect(
  state: AppState,
  backend: SessionBackend,
  dispatch: (action: AppAction) => void,
  session: SessionRecord
): void {
  logInputDebug('app.session.switch.start', {
    fromSessionId: state.currentSessionId,
    toSessionId: session.id,
    toName: session.name,
    currentTabCount: state.tabs.length,
    restoredTabCount: session.workspaceSnapshot?.tabs.length ?? 0,
  })
  const sessions = switchSessionRecords(state, session)
  saveSessionCatalog(sessions)
  void backend.destroy(true)
  dispatch({ type: 'set-sessions', sessions })
  dispatch({
    type: 'load-session',
    sessionId: session.id,
    workspaceSnapshot: session.workspaceSnapshot,
  })
  logInputDebug('app.session.switch.dispatched', { toSessionId: session.id })
}

export function handleDeleteSessionEffect(
  state: AppState,
  backend: SessionBackend,
  dispatch: (action: AppAction) => void,
  sessionId: string
): void {
  const remaining = deleteSessionRecords(state.sessions, sessionId)
  logInputDebug('app.session.delete', {
    sessionId,
    wasCurrent: sessionId === state.currentSessionId,
    remainingCount: remaining.length,
  })
  saveSessionCatalog(remaining)
  if (sessionId === state.currentSessionId) {
    void backend.destroy(true)
  }
  dispatch({ type: 'delete-session-record', sessionId })
}

export function restartTabSession(
  backend: SessionBackend,
  dispatch: (action: AppAction) => void,
  clearIdleTimer: (tabId: string) => void,
  clearStartupGrace: (tabId: string) => void,
  startTabSession: (tab: TabSession) => void,
  tab: TabSession
): void {
  logInputDebug('app.restartTab', {
    tabId: tab.id,
    command: tab.command,
    status: tab.status,
  })
  clearIdleTimer(tab.id)
  clearStartupGrace(tab.id)
  backend.disposeSession(tab.id)
  dispatch({ type: 'reset-tab-session', tabId: tab.id })
  startTabSession(tab)
}
