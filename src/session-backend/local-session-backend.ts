import { EventEmitter } from 'node:events'

import type {
  AssistantId,
  TerminalModeState,
  TerminalSnapshot,
  WorkspaceSnapshotV1,
} from '../state/types'
import type { ResizeOptions, SessionBackend, SessionBackendEvents } from './types'

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
  extends EventEmitter<SessionBackendEvents>
  implements SessionBackend
{
  private readonly sessionManager = new SessionManager()
  private currentSessionId: string | null = null
  private readonly statusLoop: ReturnType<typeof runStatusDetectionLoop>
  /**
   * Per-tab snapshot gate. While `false`, render events from the underlying
   * `sessionManager` are buffered (latest-wins) instead of being forwarded to
   * the UI. The frontend lifts the gate once `usePaneSizeReport` has reported
   * the *actual* rendered pane size via `resizeTab({ confirmedFromMeasurement })`,
   * so the first snapshot the UI ever paints is sized against the real box —
   * never against the open-loop chrome estimate used at session create / attach.
   * A tab without an entry here is treated as ready (legacy paths, sessions
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
        this.sessionManager.updateTabMetadata(found.sessionId, tabId, patch)
        if (found.sessionId === this.currentSessionId) {
          this.emit('tabMetadataUpdated', found.sessionId, tabId, patch)
        }
      },
    })
    this.sessionManager.on('render', (sessionId, tabId, viewport, terminalModes) => {
      if (sessionId !== this.currentSessionId) return
      if (this.paneReady.get(tabId) === false) {
        this.pendingRender.set(tabId, { terminalModes, viewport })
        return
      }
      this.emit('render', tabId, viewport, terminalModes)
    })
    this.sessionManager.on('exit', (sessionId, tabId, exitCode) => {
      if (sessionId === this.currentSessionId) {
        this.emit('exit', tabId, exitCode)
      }
    })
    this.sessionManager.on('error', (sessionId, tabId, message) => {
      if (sessionId === this.currentSessionId) {
        this.emit('error', tabId, message)
      }
    })
    this.statusLoop = runStatusDetectionLoop({
      listSessions: () => this.sessionManager.listSessionIds(),
      listTabs: (sessionId) => this.sessionManager.listTabs(sessionId),
      onSessionStatus: (sessionId, status) => {
        this.emit('sessionActivity', sessionId, status)
      },
      onTabStatus: (tabId, status, sessionId) => {
        if (sessionId === this.currentSessionId) {
          this.emit('tabActivity', tabId, status)
        }
      },
    })
  }

  async attach(options: {
    sessionId: string
    cols: number
    rows: number
    workspaceSnapshot?: WorkspaceSnapshotV1
  }) {
    logDebug('backend.local.attach', {
      cols: options.cols,
      rows: options.rows,
      sessionId: options.sessionId,
      snapshotTabs: options.workspaceSnapshot?.tabs.length ?? 0,
    })
    this.currentSessionId = options.sessionId
    const trees = getSnapshotTrees(options.workspaceSnapshot)
    const splitTrees = trees.filter((t) => t.type === 'split')
    if (splitTrees.length > 0) {
      const bounds = createTerminalBounds(options.cols, options.rows)
      forEachSplitPaneRect(splitTrees, bounds, (tabId, rect) => {
        const size = toTerminalContentSize(rect)
        this.gatePaneRender(tabId)
        this.sessionManager.resizeTab(options.sessionId, tabId, size.cols, size.rows)
      })
    } else {
      this.sessionManager.resize(options.sessionId, options.cols, options.rows)
    }
    const attachResult = this.sessionManager.attachSession(
      options.sessionId,
      options.workspaceSnapshot
    )
    for (const tab of attachResult.tabs) {
      this.gatePaneRender(tab.id)
      this.autoRename.register(tab)
    }
    // Run a synchronous classification pass so every tab's activity and the
    // session-status snapshot are available to embed in the reply — mirrors
    // the remote backend's behavior and keeps hydrate dispatches atomic on
    // the client side.
    this.statusLoop.classifyNow(options.sessionId, this.sessionManager.listTabs(options.sessionId))
    const tabsWithActivity = attachResult.tabs.map((tab) => ({
      ...tab,
      activity: this.statusLoop.getTabStatus(tab.id) ?? tab.activity,
    }))
    return {
      activeTabId: attachResult.activeTabId,
      initialSessionStatuses: this.statusLoop.snapshotSessions(),
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
    worktreeId?: string
    autoRenameCandidate?: boolean
  }): void {
    if (!(this.currentSessionId != null && this.currentSessionId !== '')) {
      logDebug('backend.local.skipCreateWithoutSession', { tabId: options.tabId })
      return
    }
    logDebug('backend.local.createSession', {
      sessionId: this.currentSessionId,
      tabId: options.tabId,
      title: options.title,
      worktreeId: options.worktreeId ?? null,
    })
    this.gatePaneRender(options.tabId)
    const autoRenameStatus = initialAutoRenameStatus(
      this.getAutoRenameConfig(),
      options.assistant,
      options.autoRenameCandidate === true
    )
    this.sessionManager.createTab(this.currentSessionId, { ...options, autoRenameStatus })
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
    if (!(this.currentSessionId != null && this.currentSessionId !== '')) {
      logDebug('backend.local.skipWriteWithoutSession', { inputLength: input.length, tabId })
      return
    }
    logDebug('backend.local.write', {
      inputLength: input.length,
      sessionId: this.currentSessionId,
      tabId,
    })
    this.autoRename.observeWrite(tabId, input)
    this.sessionManager.write(this.currentSessionId, tabId, input)
  }

  renameTab(tabId: string, title: string): void {
    const found = this.findTab(tabId)
    if (!found) return
    this.autoRename.manualRename(tabId)
    const patch = { autoRenameStatus: 'attempted' as const, title }
    this.sessionManager.updateTabMetadata(found.sessionId, tabId, patch)
    if (found.sessionId === this.currentSessionId) {
      this.emit('tabMetadataUpdated', found.sessionId, tabId, patch)
    }
  }

  scrollViewport(tabId: string, deltaLines: number): void {
    if (!(this.currentSessionId != null && this.currentSessionId !== '')) return
    this.sessionManager.scroll(this.currentSessionId, tabId, deltaLines)
  }

  scrollViewportToBottom(tabId: string): void {
    if (!(this.currentSessionId != null && this.currentSessionId !== '')) return
    this.sessionManager.scrollToBottom(this.currentSessionId, tabId)
  }

  setActiveTab(tabId: string | null): void {
    if (!(this.currentSessionId != null && this.currentSessionId !== '')) return
    logDebug('backend.local.setActiveTab', { sessionId: this.currentSessionId, tabId })
    this.sessionManager.setActiveTab(this.currentSessionId, tabId)
  }

  resizeAll(cols: number, rows: number, options?: ResizeOptions): void {
    if (!(this.currentSessionId != null && this.currentSessionId !== '')) return
    this.sessionManager.resize(this.currentSessionId, cols, rows, options)
  }

  resizeTab(tabId: string, cols: number, rows: number, options?: ResizeOptions): void {
    if (!(this.currentSessionId != null && this.currentSessionId !== '')) return
    this.sessionManager.resizeTab(this.currentSessionId, tabId, cols, rows, options)
    if (options?.confirmedFromMeasurement === true) {
      this.releasePaneRender(tabId)
    }
  }

  disposeSession(tabId: string): void {
    if (!(this.currentSessionId != null && this.currentSessionId !== '')) return
    logDebug('backend.local.disposeSession', { sessionId: this.currentSessionId, tabId })
    this.paneReady.delete(tabId)
    this.pendingRender.delete(tabId)
    this.autoRename.unregister(tabId)
    this.sessionManager.closeTab(this.currentSessionId, tabId)
  }

  disposeAll(): void {
    if (!(this.currentSessionId != null && this.currentSessionId !== '')) return
    logDebug('backend.local.disposeAll', { sessionId: this.currentSessionId })
    this.paneReady.clear()
    this.pendingRender.clear()
    for (const tab of this.sessionManager.listTabs(this.currentSessionId)) {
      this.autoRename.unregister(tab.id)
    }
    this.sessionManager.disposeSession(this.currentSessionId)
  }

  destroy(keepSessions = true): void {
    logDebug('backend.local.destroy', { keepSessions, sessionId: this.currentSessionId })
    if (!keepSessions && this.currentSessionId != null && this.currentSessionId !== '') {
      this.sessionManager.disposeSession(this.currentSessionId)
    }
    this.statusLoop.stop()
    this.currentSessionId = null
  }

  announceWorkspaceSwitched(_sessionId: string): void {
    // No daemon on the local backend, so there's no CLI to notify.
  }

  private findTab(
    tabId: string
  ): { sessionId: string; tab: ReturnType<SessionManager['listTabs']>[number] } | null {
    for (const sessionId of this.sessionManager.listSessionIds()) {
      const tab = this.sessionManager.listTabs(sessionId).find((entry) => entry.id === tabId)
      if (tab) return { sessionId, tab }
    }
    return null
  }

  private getAutoRenameConfig(): AutoRenameConfigSnapshot {
    return this.autoRenameConfig
  }
}
