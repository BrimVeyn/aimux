import { EventEmitter } from 'node:events'

import type {
  AssistantId,
  ProjectSnapshotV1,
  TerminalModeState,
  TerminalSnapshot,
} from '../state/types'
import type { ProjectBackendEvents, ResizeOptions, SessionBackend } from './types'

import {
  type AutoRenameConfigSnapshot,
  AutoRenameCoordinator,
  initialAutoRenameStatus,
} from '../auto-rename/coordinator'
import { SessionManager } from '../daemon/session-manager'
import { logDebug } from '../debug/input-log'
import { runStatusDetectionLoop } from '../pty/assistant-status-detection-loop'
import {
  createTerminalBounds,
  forEachSplitPaneRect,
  getSnapshotTrees,
  toTerminalContentSize,
} from '../state/layout-resize'

export class LocalSessionBackend
  extends EventEmitter<ProjectBackendEvents>
  implements SessionBackend
{
  private readonly sessionManager = new SessionManager()
  private currentProjectId: string | null = null
  private readonly statusLoop: ReturnType<typeof runStatusDetectionLoop>
  /**
   * Per-tab snapshot gate. While `false`, render events from the underlying
   * `sessionManager` are buffered (latest-wins) instead of being forwarded to
   * the UI. The frontend lifts the gate once `usePaneSizeReport` has reported
   * the *actual* rendered pane size via `resizeTab({ confirmedFromMeasurement })`,
   * so the first snapshot the UI ever paints is sized against the real box —
   * never against the open-loop chrome estimate used at project create / attach.
   * A tab without an entry here is treated as ready (legacy paths, projects
   * not subject to the gate). See plan: il-y-a-eu-stateful-boot.md.
   */
  private readonly paneReady = new Map<string, boolean>()
  private readonly pendingRender = new Map<
    string,
    { viewport: TerminalSnapshot; terminalModes: TerminalModeState }
  >()
  private readonly autoRename: AutoRenameCoordinator
  private readonly autoRenameConfig: AutoRenameConfigSnapshot

  constructor(
    autoRenameConfig: AutoRenameConfigSnapshot = { enabled: false, models: {}, timeoutMs: 15_000 }
  ) {
    super()
    this.autoRenameConfig = autoRenameConfig
    this.autoRename = new AutoRenameCoordinator({
      config: autoRenameConfig,
      getTab: (tabId) => this.findTab(tabId)?.tab,
      updateTab: (tabId, patch) => {
        const found = this.findTab(tabId)
        if (!found) return
        this.sessionManager.updateTabMetadata(found.projectId, tabId, patch)
        if (found.projectId === this.currentProjectId) {
          this.emit('tabMetadataUpdated', found.projectId, tabId, patch)
        }
      },
    })
    this.sessionManager.on('bytes', (projectId, tabId, data) => {
      if (projectId === this.currentProjectId) {
        this.emit('bytes', tabId, data)
      }
    })
    this.sessionManager.on('render', (projectId, tabId, viewport, terminalModes) => {
      if (projectId !== this.currentProjectId) return
      if (this.paneReady.get(tabId) === false) {
        this.pendingRender.set(tabId, { terminalModes, viewport })
        return
      }
      this.emit('render', tabId, viewport, terminalModes)
    })
    this.sessionManager.on('exit', (projectId, tabId, exitCode) => {
      if (projectId === this.currentProjectId) {
        this.emit('exit', tabId, exitCode)
      }
    })
    this.sessionManager.on('error', (projectId, tabId, message) => {
      if (projectId === this.currentProjectId) {
        this.emit('error', tabId, message)
      }
    })
    this.statusLoop = runStatusDetectionLoop({
      listProjects: () => this.sessionManager.listSessionIds(),
      listTabs: (projectId) => this.sessionManager.listTabs(projectId),
      onProjectStatus: (projectId, status) => {
        this.emit('projectActivity', projectId, status)
      },
      onTabStatus: (tabId, status, projectId, workspaceId) => {
        if (projectId === this.currentProjectId) {
          this.emit('tabActivity', tabId, status, workspaceId)
        }
      },
      onTurnComplete: (tabId, projectId, _idleMs, workspaceId) => {
        this.emit('tabTurnComplete', tabId, projectId, workspaceId)
      },
    })
  }

  async attach(options: {
    projectId: string
    cols: number
    rows: number
    projectSnapshot?: ProjectSnapshotV1
  }) {
    logDebug('backend.local.attach', {
      cols: options.cols,
      projectId: options.projectId,
      rows: options.rows,
      snapshotTabs: options.projectSnapshot?.tabs.length ?? 0,
    })
    this.currentProjectId = options.projectId
    const trees = getSnapshotTrees(options.projectSnapshot)
    const splitTrees = trees.filter((t) => t.type === 'split')
    if (splitTrees.length > 0) {
      const bounds = createTerminalBounds(options.cols, options.rows)
      forEachSplitPaneRect(splitTrees, bounds, (tabId, rect) => {
        const size = toTerminalContentSize(rect)
        this.gatePaneRender(tabId)
        this.sessionManager.resizeTab(options.projectId, tabId, size.cols, size.rows)
      })
    } else {
      this.sessionManager.resize(options.projectId, options.cols, options.rows)
    }
    const attachResult = this.sessionManager.attachSession(
      options.projectId,
      options.projectSnapshot
    )
    for (const tab of attachResult.tabs) {
      this.gatePaneRender(tab.id)
      this.autoRename.register(tab)
    }
    // Run a synchronous classification pass so every tab's activity and the
    // project-status snapshot are available to embed in the reply — mirrors
    // the remote backend's behavior and keeps hydrate dispatches atomic on
    // the client side.
    this.statusLoop.classifyNow(options.projectId, this.sessionManager.listTabs(options.projectId))
    const tabsWithActivity = attachResult.tabs.map((tab) => ({
      ...tab,
      activity: this.statusLoop.getTabStatus(tab.id) ?? tab.activity,
    }))
    return {
      activeTabId: attachResult.activeTabId,
      initialProjectStatuses: this.statusLoop.snapshotProjects(),
      tabs: tabsWithActivity,
    }
  }

  createSession(options: {
    tabId: string
    assistant: AssistantId
    title: string
    command: string
    args?: string[]
    cols: number
    rows: number
    cwd?: string
    workspaceId?: string
    autoRenameCandidate?: boolean
  }): void {
    if (!(this.currentProjectId != null && this.currentProjectId !== '')) {
      logDebug('backend.local.skipCreateWithoutProject', { tabId: options.tabId })
      return
    }
    logDebug('backend.local.createSession', {
      projectId: this.currentProjectId,
      tabId: options.tabId,
      title: options.title,
      workspaceId: options.workspaceId ?? null,
    })
    this.gatePaneRender(options.tabId)
    const autoRenameStatus = initialAutoRenameStatus(
      this.getAutoRenameConfig(),
      options.assistant,
      options.autoRenameCandidate === true
    )
    this.sessionManager.createTab(this.currentProjectId, { ...options, autoRenameStatus })
    const tab = this.findTab(options.tabId)?.tab
    if (tab) this.autoRename.register(tab)
  }

  /** Suppress render emission for this tab until the frontend acknowledges its
   *  measured pane size via `resizeTab({ confirmedFromMeasurement: true })`. */
  private gatePaneRender(tabId: string): void {
    this.paneReady.set(tabId, false)
    this.pendingRender.delete(tabId)
  }

  /** Lift the suppression and flush the most recent buffered snapshot, if any. */
  private releasePaneRender(tabId: string): void {
    if (this.paneReady.get(tabId) === true) return
    this.paneReady.set(tabId, true)
    const pending = this.pendingRender.get(tabId)
    if (!pending) return
    this.pendingRender.delete(tabId)
    this.emit('render', tabId, pending.viewport, pending.terminalModes)
  }

  write(tabId: string, input: string): void {
    if (!(this.currentProjectId != null && this.currentProjectId !== '')) {
      logDebug('backend.local.skipWriteWithoutProject', { inputLength: input.length, tabId })
      return
    }
    logDebug('backend.local.write', {
      inputLength: input.length,
      projectId: this.currentProjectId,
      tabId,
    })
    this.autoRename.observeWrite(tabId, input)
    this.sessionManager.write(this.currentProjectId, tabId, input)
  }

  renameTab(tabId: string, title: string): void {
    const found = this.findTab(tabId)
    if (!found) return
    this.autoRename.manualRename(tabId)
    const patch = { autoRenameStatus: 'attempted' as const, title }
    this.sessionManager.updateTabMetadata(found.projectId, tabId, patch)
    if (found.projectId === this.currentProjectId) {
      this.emit('tabMetadataUpdated', found.projectId, tabId, patch)
    }
  }

  scrollViewport(tabId: string, deltaLines: number): void {
    if (!(this.currentProjectId != null && this.currentProjectId !== '')) return
    this.sessionManager.scroll(this.currentProjectId, tabId, deltaLines)
  }

  scrollViewportToBottom(tabId: string): void {
    if (!(this.currentProjectId != null && this.currentProjectId !== '')) return
    this.sessionManager.scrollToBottom(this.currentProjectId, tabId)
  }

  async serializeBuffer(tabId: string): Promise<string> {
    if (!(this.currentProjectId != null && this.currentProjectId !== '')) return ''
    return this.sessionManager.serializeBuffer(this.currentProjectId, tabId)
  }

  // No-op: the local backend always emits raw PTY bytes via the in-process
  // SessionManager. The opt-in only matters for the remote (daemon) backend
  // where bytes traverse a Unix socket.
  async setBytesEnabled(_enabled: boolean): Promise<void> {}

  setActiveTab(tabId: string | null): void {
    if (!(this.currentProjectId != null && this.currentProjectId !== '')) return
    logDebug('backend.local.setActiveTab', { projectId: this.currentProjectId, tabId })
    this.sessionManager.setActiveTab(this.currentProjectId, tabId)
  }

  resizeAll(cols: number, rows: number, options?: ResizeOptions): void {
    if (!(this.currentProjectId != null && this.currentProjectId !== '')) return
    this.sessionManager.resize(this.currentProjectId, cols, rows, options)
  }

  resizeTab(tabId: string, cols: number, rows: number, options?: ResizeOptions): void {
    if (!(this.currentProjectId != null && this.currentProjectId !== '')) return
    this.sessionManager.resizeTab(this.currentProjectId, tabId, cols, rows, options)
    if (options?.confirmedFromMeasurement === true) {
      this.releasePaneRender(tabId)
    }
  }

  disposeSession(tabId: string): void {
    if (!(this.currentProjectId != null && this.currentProjectId !== '')) return
    logDebug('backend.local.disposeSession', { projectId: this.currentProjectId, tabId })
    this.paneReady.delete(tabId)
    this.pendingRender.delete(tabId)
    this.autoRename.unregister(tabId)
    this.sessionManager.closeTab(this.currentProjectId, tabId)
  }

  disposeAll(): void {
    if (!(this.currentProjectId != null && this.currentProjectId !== '')) return
    logDebug('backend.local.disposeAll', { projectId: this.currentProjectId })
    this.paneReady.clear()
    this.pendingRender.clear()
    for (const tab of this.sessionManager.listTabs(this.currentProjectId)) {
      this.autoRename.unregister(tab.id)
    }
    this.sessionManager.disposeSession(this.currentProjectId)
  }

  destroy(keepSessions = true): void {
    logDebug('backend.local.destroy', { keepSessions, projectId: this.currentProjectId })
    if (!keepSessions && this.currentProjectId != null && this.currentProjectId !== '') {
      this.sessionManager.disposeSession(this.currentProjectId)
    }
    this.statusLoop.stop()
    this.currentProjectId = null
  }

  announceProjectSwitched(_projectId: string): void {
    // No daemon on the local backend, so there's no CLI to notify.
  }

  private findTab(
    tabId: string
  ): { projectId: string; tab: ReturnType<SessionManager['listTabs']>[number] } | null {
    for (const projectId of this.sessionManager.listSessionIds()) {
      const tab = this.sessionManager.listTabs(projectId).find((entry) => entry.id === tabId)
      if (tab) return { projectId, tab }
    }
    return null
  }

  private getAutoRenameConfig(): AutoRenameConfigSnapshot {
    return this.autoRenameConfig
  }
}
