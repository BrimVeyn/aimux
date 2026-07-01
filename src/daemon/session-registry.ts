import { EventEmitter } from 'node:events'

import type {
  TabSession,
  TerminalModeState,
  TerminalSnapshot,
  WorkspaceSnapshotV1,
} from '../state/types'

import { logDebug } from '../debug/input-log'
import { PtyManager } from '../pty/pty-manager'
import {
  normalizeGroupedTabOrder,
  restoreLayoutTrees,
  restoreTabsFromWorkspace,
} from '../state/session-persistence'
import { createDefaultTerminalModes } from '../state/terminal-modes'

interface SessionRegistryEvents {
  render: [tabId: string, viewport: TerminalSnapshot, terminalModes: TerminalModeState]
  exit: [tabId: string, exitCode: number]
  error: [tabId: string, message: string]
}

export class SessionRegistry extends EventEmitter<SessionRegistryEvents> {
  private readonly ptyManager = new PtyManager()
  private tabs = new Map<string, TabSession>()
  private activeTabId: string | null = null

  constructor() {
    super()
    this.ptyManager.on('render', (tabId, viewport, terminalModes) => {
      const tab = this.tabs.get(tabId)
      if (!tab) {
        return
      }
      tab.viewport = viewport
      tab.terminalModes = terminalModes
      if (tab.status === 'starting') {
        tab.status = 'running'
      }
      logDebug('daemon.registry.render', { status: tab.status, tabId })
      this.emit('render', tabId, viewport, terminalModes)
    })
    this.ptyManager.on('exit', (tabId, exitCode) => {
      if (!this.tabs.has(tabId)) {
        return
      }
      this.tabs.delete(tabId)
      if (this.activeTabId === tabId) {
        this.activeTabId = this.listTabs()[0]?.id ?? null
      }
      logDebug('daemon.registry.exit', { exitCode, tabId })
      this.emit('exit', tabId, exitCode)
    })
    this.ptyManager.on('error', (tabId, message) => {
      const tab = this.tabs.get(tabId)
      if (tab) {
        tab.status = 'error'
        tab.errorMessage = message
        tab.activity = undefined
      }
      logDebug('daemon.registry.error', { message, tabId })
      this.emit('error', tabId, message)
    })
  }

  attachFromSnapshot(snapshot: WorkspaceSnapshotV1 | undefined): {
    tabs: TabSession[]
    activeTabId: string | null
  } {
    logDebug('daemon.registry.attach', {
      existingTabs: this.tabs.size,
      hasSnapshot: !!snapshot,
      snapshotTabs: snapshot?.tabs.length ?? 0,
    })
    if (this.tabs.size === 0 && snapshot) {
      const restoredTabs = restoreTabsFromWorkspace(snapshot)
      for (const tab of restoredTabs) {
        this.tabs.set(tab.id, tab)
      }
      this.activeTabId =
        snapshot.activeTabId != null &&
        snapshot.activeTabId !== '' &&
        restoredTabs.some((tab) => tab.id === snapshot.activeTabId)
          ? snapshot.activeTabId
          : (restoredTabs[0]?.id ?? null)
    } else if (this.tabs.size > 0 && snapshot) {
      for (const persisted of snapshot.tabs) {
        const existing = this.tabs.get(persisted.id)
        if (existing) {
          existing.title = persisted.title
          existing.worktreeId = persisted.worktreeId
        }
      }
      if (
        snapshot.activeTabId != null &&
        snapshot.activeTabId !== '' &&
        this.tabs.has(snapshot.activeTabId)
      ) {
        this.activeTabId = snapshot.activeTabId
      }
    }

    const tabs = this.listTabs()
    if (!snapshot) {
      return { activeTabId: this.activeTabId, tabs }
    }

    const { layoutTrees, tabGroupMap } = restoreLayoutTrees(snapshot, tabs)
    const orderedSnapshotTabs = snapshot.tabs
      .map((persistedTab) => this.tabs.get(persistedTab.id))
      .filter((tab): tab is TabSession => tab !== undefined)
    const normalizedTabs = normalizeGroupedTabOrder(orderedSnapshotTabs, layoutTrees, tabGroupMap)

    return { activeTabId: this.activeTabId, tabs: normalizedTabs }
  }

  listTabs(): TabSession[] {
    return [...this.tabs.values()]
  }

  createSession(options: {
    tabId: string
    assistant: TabSession['assistant']
    title: string
    command: string
    args?: string[]
    cols: number
    rows: number
    cwd?: string
    /** Extra env injected into the spawned shell. Passed through to the PTY. */
    env?: Record<string, string>
    /**
     * Worktree this tab belongs to (for UI grouping). Stored on the
     * TabSession so an attach-time replay surfaces it inside the right
     * worktree column. Optional — tabs not bound to a worktree are valid.
     */
    worktreeId?: string
  }): void {
    logDebug('daemon.registry.createSession', {
      args: options.args ?? [],
      assistant: options.assistant,
      command: options.command,
      tabId: options.tabId,
      title: options.title,
    })
    const existing = this.tabs.get(options.tabId)
    if (!existing) {
      this.tabs.set(options.tabId, {
        activity: 'idle',
        assistant: options.assistant,
        buffer: '',
        command: [options.command, ...(options.args ?? [])].join(' '),
        id: options.tabId,
        status: 'starting',
        terminalModes: createDefaultTerminalModes(),
        title: options.title,
        worktreeId: options.worktreeId,
      })
    } else {
      existing.status = 'starting'
      existing.activity = 'idle'
      existing.errorMessage = undefined
      existing.exitCode = undefined
      existing.viewport = undefined
      existing.terminalModes = createDefaultTerminalModes()
      existing.assistant = options.assistant
      existing.title = options.title
      existing.command = [options.command, ...(options.args ?? [])].join(' ')
      if (options.worktreeId !== undefined) existing.worktreeId = options.worktreeId
    }

    this.activeTabId = options.tabId
    this.ptyManager.createSession(options)
  }

  /**
   * Read the in-memory TabSession for a tab. Returned by reference — used by
   * the daemon's `tabAdded` broadcast path to publish the same shape the UI
   * already knows how to ingest from `attachResult.tabs[]`.
   */
  getTab(tabId: string): TabSession | undefined {
    return this.tabs.get(tabId)
  }

  write(tabId: string, data: string): void {
    this.ptyManager.write(tabId, data)
  }

  resizeAll(cols: number, rows: number, options?: { sync?: boolean }): void {
    this.ptyManager.resizeAll(cols, rows, options)
  }

  resizeTab(tabId: string, cols: number, rows: number, options?: { sync?: boolean }): void {
    this.ptyManager.resizeSession(tabId, cols, rows, options)
  }

  scrollViewport(tabId: string, deltaLines: number): void {
    this.ptyManager.scrollViewport(tabId, deltaLines)
  }

  scrollViewportToBottom(tabId: string): void {
    this.ptyManager.scrollViewportToBottom(tabId)
  }

  setActiveTab(tabId: string | null): void {
    if (tabId === null) {
      this.activeTabId = null
      return
    }

    if (this.tabs.has(tabId)) {
      this.activeTabId = tabId
    }
  }

  setBroadcastEnabled(enabled: boolean): void {
    this.ptyManager.setBroadcastEnabled(enabled)
  }

  hasSessions(): boolean {
    return this.ptyManager.hasSessions()
  }

  closeTab(tabId: string): void {
    logDebug('daemon.registry.closeTab', { tabId })
    this.ptyManager.disposeSession(tabId)
    this.tabs.delete(tabId)
    if (this.activeTabId === tabId) {
      this.activeTabId = this.listTabs()[0]?.id ?? null
    }
  }

  disposeAll(): void {
    logDebug('daemon.registry.disposeAll', { tabCount: this.tabs.size })
    this.ptyManager.disposeAll()
    this.tabs.clear()
    this.activeTabId = null
  }
}
