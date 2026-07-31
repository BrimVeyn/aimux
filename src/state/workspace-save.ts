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
    bars: state.bars,
    customCommands: state.customCommands,
    gitPane: {
      diffModeRatio: state.gitPane.diffModeRatio,
      fileListMode: state.gitPane.fileListMode,
    },
    sessionBarVisible: state.sessionBar.visible,
    // Legacy mirror of the left bar: lets an older build (and the workspace
    // snapshot schema) still find a sidebar after a downgrade.
    sidebar: {
      visible: state.bars.left.visible,
      width: state.bars.left.width,
    },
  })
  saveSessionCatalog(
    buildSessionsWithCurrentSnapshot(state.sessions, state.currentSessionId, state)
  )
}
