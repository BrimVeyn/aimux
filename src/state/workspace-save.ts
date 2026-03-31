import type { AppState, SessionRecord } from './types'

import { loadConfig, saveConfig } from '../config'
import { saveSessionCatalog } from './session-catalog'
import { serializeWorkspace } from './session-persistence'

export function buildSessionsWithCurrentSnapshot(
  sessions: SessionRecord[],
  currentSessionId: string | null,
  state: AppState
): SessionRecord[] {
  return sessions.map((session) =>
    session.id === currentSessionId
      ? {
          ...session,
          updatedAt: new Date().toISOString(),
          workspaceSnapshot: serializeWorkspace(state),
        }
      : session
  )
}

export function saveCurrentWorkspace(state: AppState): void {
  saveConfig({
    ...loadConfig(),
    customCommands: state.customCommands,
  })
  saveSessionCatalog(
    buildSessionsWithCurrentSnapshot(state.sessions, state.currentSessionId, state)
  )
}
