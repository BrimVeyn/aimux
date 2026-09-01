import type { EventEmitter } from 'node:events'

import type {
  ProjectSnapshotV1,
  ProjectStatus,
  TabActivity,
  TabSession,
  TerminalModeState,
  TerminalSnapshot,
  WorkspaceRecord,
} from '../state/types'

export interface ProjectBackendEvents {
  render: [tabId: string, viewport: TerminalSnapshot, terminalModes: TerminalModeState]
  bytes: [tabId: string, data: string]
  exit: [tabId: string, exitCode: number]
  error: [tabId: string, message: string]
  projectActivity: [projectId: string, status: ProjectStatus]
  /**
   * `workspaceId` is present when the backend knows which workspace the tab
   * belongs to. The UI holds tabs for the attached project only, so this is
   * what lets a *foreign* project's workspace row show a status glyph.
   */
  tabActivity: [tabId: string, activity: TabActivity, workspaceId?: string]
  /**
   * A tab's turn ended: its `idle` held for the daemon's settle window. Edge
   * triggered, once per turn — the honest "the agent has finished" signal,
   * unlike a raw `idle` which flickers between tool calls.
   */
  tabTurnComplete: [tabId: string, projectId: string, workspaceId?: string]
  /**
   * Fired when a tab was added by a sibling client (e.g. the CLI control
   * plane creating a tab in the same project). The UI subscribes and
   * dispatches `add-tab` so its store learns about the new tab before any
   * `tabRender` event lands.
   */
  tabAdded: [projectId: string, tab: TabSession]
  tabMetadataUpdated: [
    projectId: string,
    tabId: string,
    patch: { title?: string; autoRenameStatus?: 'eligible' | 'attempted' },
  ]
  /**
   * v12 project-lifecycle events. Fired when a CLI issued
   * `createProject` / `switchProject` / `closeProject` and the daemon
   * relays as an event because a UI is attached. The UI reducer owns the
   * catalog write; see `backend-runtime-events.ts` for the wiring.
   */
  projectCreateRequested: [name: string, projectPath: string | undefined, doSwitch: boolean]
  projectSwitchRequested: [targetProjectId: string]
  projectCloseRequested: [targetProjectId: string]
  projectSwitched: [projectId: string]
  /**
   * v12 workspace-lifecycle events. Fired when a CLI issued
   * `addWorkspaceRecord` / `removeWorkspaceRecord` and the daemon relays.
   */
  workspaceAdded: [projectId: string, workspace: WorkspaceRecord]
  workspaceRemoved: [projectId: string, workspaceId: string]
}

export interface ResizeOptions {
  /** When set, opentui's flush is invoked synchronously so the resize lands
   *  in the same commit. Used by the chrome cascade to keep the cols/rows
   *  state and the backend buffer in lockstep on sidebar/project-bar toggles. */
  sync?: boolean
  /** When true, this resize is the closed-loop measurement of the rendered
   *  content box — the authoritative size for the visible viewport. The
   *  `LocalSessionBackend` uses this to lift the per-tab snapshot gate that
   *  suppresses renders between project/attach time and the first measurement,
   *  so the frontend never paints a snapshot whose row count disagrees with
   *  the pane's actual height. */
  confirmedFromMeasurement?: boolean
}

export interface BackendAttachResult {
  tabs: TabSession[]
  activeTabId: string | null
  /**
   * Per-project status snapshot taken at attach time and applied
   * atomically with tab hydration to prevent an unknown-tab race on
   * separate `projectActivity` events.
   */
  initialProjectStatuses: { projectId: string; status: ProjectStatus }[]
}

export interface SessionBackend extends EventEmitter<ProjectBackendEvents> {
  attach(options: {
    projectId: string
    cols: number
    rows: number
    projectSnapshot?: ProjectSnapshotV1
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
    /** Workspace the tab belongs to. Passed through to the daemon so its
     *  registry surfaces the right grouping in `listTabs` for headless
     *  consumers (CLI control plane). */
    workspaceId?: string
    autoRenameCandidate?: boolean
  }): void
  write(tabId: string, input: string): void
  renameTab(tabId: string, title: string): void
  scrollViewport(tabId: string, deltaLines: number): void
  scrollViewportToBottom(tabId: string): void
  serializeBuffer(tabId: string): Promise<string>
  /**
   * Opt-in to the raw PTY byte stream (`bytes` events). Only the GUI host
   * needs them — the TUI consumes render snapshots. Optional because the
   * local backend always emits bytes regardless.
   */
  setBytesEnabled?(enabled: boolean): Promise<void>
  setActiveTab(tabId: string | null): void
  resizeAll(cols: number, rows: number, options?: ResizeOptions): void
  resizeTab(tabId: string, cols: number, rows: number, options?: ResizeOptions): void
  disposeSession(tabId: string): void
  disposeAll(): void
  destroy(keepSessions?: boolean): Promise<void> | void
  /**
   * v12 — the UI calls this after `handleSwitchProjectEffect` finishes so the
   * daemon can broadcast `projectSwitched` and any `aimux project switch
   * --wait` CLI can exit. No-op on local backends (no daemon).
   */
  announceProjectSwitched(projectId: string): void
}
