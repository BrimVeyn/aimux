import type { EventEmitter } from 'node:events'

import type {
  SessionStatus,
  TabActivity,
  TabSession,
  TerminalModeState,
  TerminalSnapshot,
  WorkspaceSnapshotV1,
} from '../state/types'

export interface SessionBackendEvents {
  render: [tabId: string, viewport: TerminalSnapshot, terminalModes: TerminalModeState]
  bytes: [tabId: string, data: string]
  exit: [tabId: string, exitCode: number]
  error: [tabId: string, message: string]
  sessionActivity: [sessionId: string, status: SessionStatus]
  tabActivity: [tabId: string, activity: TabActivity]
}

export interface BackendAttachResult {
  tabs: TabSession[]
  activeTabId: string | null
  /**
   * Per-session status snapshot taken at attach time and applied
   * atomically with tab hydration to prevent an unknown-tab race on
   * separate `sessionActivity` events.
   */
  initialSessionStatuses: { sessionId: string; status: SessionStatus }[]
}

export interface SessionBackend extends EventEmitter<SessionBackendEvents> {
  attach(options: {
    sessionId: string
    cols: number
    rows: number
    workspaceSnapshot?: WorkspaceSnapshotV1
  }): Promise<BackendAttachResult | null>
  createSession(options: {
    tabId: string
    assistant: TabSession['assistant']
    title: string
    command: string
    args?: string[]
    cols: number
    rows: number
    cwd?: string
  }): void
  write(tabId: string, input: string): void
  scrollViewport(tabId: string, deltaLines: number): void
  scrollViewportToBottom(tabId: string): void
  serializeBuffer(tabId: string): string
  setActiveTab(tabId: string | null): void
  resizeAll(cols: number, rows: number, options?: { sync?: boolean }): void
  resizeTab(tabId: string, cols: number, rows: number, options?: { sync?: boolean }): void
  disposeSession(tabId: string): void
  disposeAll(): void
  destroy(keepSessions?: boolean): Promise<void> | void
}
