import type { SessionBackend } from '../session-backend/types'
import type { AppAction, AppState, SessionRecord, TabSession } from '../state/types'

import { logInputDebug } from '../debug/input-log'
import { createPrefixedId } from '../platform/id'
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
    createdAt: now,
    id: createPrefixedId('session'),
    lastOpenedAt: now,
    name,
    projectPath,
    updatedAt: now,
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
    fromCurrentWorkspace: !state.currentSessionId && state.tabs.length > 0,
    name,
    sessionId: session.id,
    tabCount: session.workspaceSnapshot?.tabs.length ?? 0,
  })
  saveSessionCatalog(sessions)
  dispatch({ sessions, type: 'set-sessions' })
  dispatch({
    sessionId: session.id,
    type: 'load-session',
    workspaceSnapshot: session.workspaceSnapshot,
  })
}

export function handleRenameSessionEffect(
  sessions: SessionRecord[],
  dispatch: (action: AppAction) => void,
  sessionId: string,
  name: string
): void {
  logInputDebug('app.session.rename', { name, sessionId })
  const renamed = renameSessionRecords(sessions, sessionId, name)
  saveSessionCatalog(renamed)
  dispatch({ name, sessionId, type: 'rename-session-record' })
}

export function handleSwitchSessionEffect(
  state: AppState,
  backend: SessionBackend,
  dispatch: (action: AppAction) => void,
  session: SessionRecord
): void {
  logInputDebug('app.session.switch.start', {
    currentTabCount: state.tabs.length,
    fromSessionId: state.currentSessionId,
    restoredTabCount: session.workspaceSnapshot?.tabs.length ?? 0,
    toName: session.name,
    toSessionId: session.id,
  })
  const sessions = switchSessionRecords(state, session)
  saveSessionCatalog(sessions)
  void backend.destroy(true)
  dispatch({ sessions, type: 'set-sessions' })
  dispatch({
    sessionId: session.id,
    type: 'load-session',
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
    remainingCount: remaining.length,
    sessionId,
    wasCurrent: sessionId === state.currentSessionId,
  })
  saveSessionCatalog(remaining)
  if (sessionId === state.currentSessionId) {
    void backend.destroy(true)
  }
  dispatch({ sessionId, type: 'delete-session-record' })
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
    command: tab.command,
    status: tab.status,
    tabId: tab.id,
  })
  clearIdleTimer(tab.id)
  clearStartupGrace(tab.id)
  backend.disposeSession(tab.id)
  dispatch({ tabId: tab.id, type: 'reset-tab-session' })
  startTabSession(tab)
}
