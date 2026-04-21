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
    gitPane: {
      diffModeRatio: state.gitPane.diffModeRatio,
      embeddedRatio: state.gitPane.embeddedRatio,
      fileListMode: state.gitPane.fileListMode,
      mode: state.gitPane.mode,
      paneRatio: state.gitPane.paneRatio,
      position: state.gitPane.position,
      visible: state.gitPane.visible,
    },
    sessionBarPosition: state.sessionBar.position,
    sessionBarVisible: state.sessionBar.visible,
    sidebar: {
      visible: state.sidebar.visible,
      width: state.sidebar.width,
    },
  })
  saveSessionCatalog(
    buildSessionsWithCurrentSnapshot(state.sessions, state.currentSessionId, state)
  )
}
