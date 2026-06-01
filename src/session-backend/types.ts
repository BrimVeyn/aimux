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
  exit: [tabId: string, exitCode: number]
  error: [tabId: string, message: string]
  sessionActivity: [sessionId: string, status: SessionStatus]
  tabActivity: [tabId: string, activity: TabActivity]
}

export interface ResizeOptions {
  /** When set, opentui's flush is invoked synchronously so the resize lands
   *  in the same commit. Used by the chrome cascade to keep the cols/rows
   *  state and the backend buffer in lockstep on sidebar/session-bar toggles. */
  sync?: boolean
  /** When true, this resize is the closed-loop measurement of the rendered
   *  content box — the authoritative size for the visible viewport. The
   *  `LocalSessionBackend` uses this to lift the per-tab snapshot gate that
   *  suppresses renders between session/attach time and the first measurement,
   *  so the frontend never paints a snapshot whose row count disagrees with
   *  the pane's actual height. */
  confirmedFromMeasurement?: boolean
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
  setActiveTab(tabId: string | null): void
  resizeAll(cols: number, rows: number, options?: ResizeOptions): void
  resizeTab(tabId: string, cols: number, rows: number, options?: ResizeOptions): void
  disposeSession(tabId: string): void
  disposeAll(): void
  destroy(keepSessions?: boolean): Promise<void> | void
}
