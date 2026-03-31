import { EventEmitter } from 'node:events'

import type {
  TabSession,
  TerminalModeState,
  TerminalSnapshot,
  WorkspaceSnapshotV1,
} from '../state/types'

import { logDebug } from '../debug/input-log'
import { PtyManager } from '../pty/pty-manager'
import { restoreTabsFromWorkspace } from '../state/session-persistence'

type SessionRegistryEvents = {
  render: [tabId: string, viewport: TerminalSnapshot, terminalModes: TerminalModeState]
  exit: [tabId: string, exitCode: number]
  error: [tabId: string, message: string]
}

function defaultTerminalModes(): TerminalModeState {
  return {
    mouseTrackingMode: 'none',
    sendFocusMode: false,
    alternateScrollMode: false,
    isAlternateBuffer: false,
    bracketedPasteMode: false,
  }
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
      logDebug('daemon.registry.render', { tabId, status: tab.status })
      this.emit('render', tabId, viewport, terminalModes)
    })
    this.ptyManager.on('exit', (tabId, exitCode) => {
      const tab = this.tabs.get(tabId)
      if (!tab) {
        return
      }
      tab.status = 'exited'
      tab.exitCode = exitCode
      tab.activity = undefined
      logDebug('daemon.registry.exit', { tabId, exitCode })
      this.emit('exit', tabId, exitCode)
    })
    this.ptyManager.on('error', (tabId, message) => {
      const tab = this.tabs.get(tabId)
      if (tab) {
        tab.status = 'error'
        tab.errorMessage = message
        tab.activity = undefined
      }
      logDebug('daemon.registry.error', { tabId, message })
      this.emit('error', tabId, message)
    })
  }

  attachFromSnapshot(snapshot: WorkspaceSnapshotV1 | undefined): {
    tabs: TabSession[]
    activeTabId: string | null
  } {
    logDebug('daemon.registry.attach', {
      hasSnapshot: !!snapshot,
      existingTabs: this.tabs.size,
      snapshotTabs: snapshot?.tabs.length ?? 0,
    })
    if (this.tabs.size === 0 && snapshot) {
      const restoredTabs = restoreTabsFromWorkspace(snapshot)
      for (const tab of restoredTabs) {
        this.tabs.set(tab.id, tab)
      }
      this.activeTabId =
        snapshot.activeTabId && restoredTabs.some((tab) => tab.id === snapshot.activeTabId)
          ? snapshot.activeTabId
          : (restoredTabs[0]?.id ?? null)
    } else if (this.tabs.size > 0 && snapshot) {
      for (const persisted of snapshot.tabs) {
        const existing = this.tabs.get(persisted.id)
        if (existing) {
          existing.title = persisted.title
        }
      }
      if (snapshot.activeTabId && this.tabs.has(snapshot.activeTabId)) {
        this.activeTabId = snapshot.activeTabId
      }
    }

    return { tabs: this.listTabs(), activeTabId: this.activeTabId }
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
  }): void {
    logDebug('daemon.registry.createSession', {
      tabId: options.tabId,
      assistant: options.assistant,
      title: options.title,
      command: options.command,
      args: options.args ?? [],
    })
    const existing = this.tabs.get(options.tabId)
    if (!existing) {
      this.tabs.set(options.tabId, {
        id: options.tabId,
        assistant: options.assistant,
        title: options.title,
        status: 'starting',
        activity: 'idle',
        buffer: '',
        terminalModes: defaultTerminalModes(),
        command: [options.command, ...(options.args ?? [])].join(' '),
      })
    } else {
      existing.status = 'starting'
      existing.activity = 'idle'
      existing.errorMessage = undefined
      existing.exitCode = undefined
      existing.viewport = undefined
      existing.terminalModes = defaultTerminalModes()
      existing.assistant = options.assistant
      existing.title = options.title
      existing.command = [options.command, ...(options.args ?? [])].join(' ')
    }

    this.activeTabId = options.tabId
    this.ptyManager.createSession(options)
  }

  write(tabId: string, data: string): void {
    this.ptyManager.write(tabId, data)
  }

  resizeAll(cols: number, rows: number): void {
    this.ptyManager.resizeAll(cols, rows)
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
