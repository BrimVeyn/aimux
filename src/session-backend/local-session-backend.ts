import { EventEmitter } from 'node:events'

import type { AssistantId, WorkspaceSnapshotV1 } from '../state/types'
import type { SessionBackend, SessionBackendEvents } from './types'

import { SessionManager } from '../daemon/session-manager'
import { logDebug } from '../debug/input-log'
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

  constructor() {
    super()
    this.sessionManager.on('render', (sessionId, tabId, viewport, terminalModes) => {
      if (sessionId === this.currentSessionId) {
        this.emit('render', tabId, viewport, terminalModes)
      }
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
        this.sessionManager.resizeTab(options.sessionId, tabId, size.cols, size.rows)
      })
    } else {
      this.sessionManager.resize(options.sessionId, options.cols, options.rows)
    }
    return this.sessionManager.attachSession(options.sessionId, options.workspaceSnapshot)
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
  }): void {
    if (!this.currentSessionId) {
      logDebug('backend.local.skipCreateWithoutSession', { tabId: options.tabId })
      return
    }
    logDebug('backend.local.createSession', {
      sessionId: this.currentSessionId,
      tabId: options.tabId,
      title: options.title,
    })
    this.sessionManager.createTab(this.currentSessionId, options)
  }

  write(tabId: string, input: string): void {
    if (!this.currentSessionId) {
      logDebug('backend.local.skipWriteWithoutSession', { inputLength: input.length, tabId })
      return
    }
    logDebug('backend.local.write', {
      inputLength: input.length,
      sessionId: this.currentSessionId,
      tabId,
    })
    this.sessionManager.write(this.currentSessionId, tabId, input)
  }

  scrollViewport(tabId: string, deltaLines: number): void {
    if (!this.currentSessionId) {
      return
    }
    this.sessionManager.scroll(this.currentSessionId, tabId, deltaLines)
  }

  scrollViewportToBottom(tabId: string): void {
    if (!this.currentSessionId) {
      return
    }
    this.sessionManager.scrollToBottom(this.currentSessionId, tabId)
  }

  setActiveTab(tabId: string | null): void {
    if (!this.currentSessionId) {
      return
    }
    logDebug('backend.local.setActiveTab', { sessionId: this.currentSessionId, tabId })
    this.sessionManager.setActiveTab(this.currentSessionId, tabId)
  }

  resizeAll(cols: number, rows: number): void {
    if (!this.currentSessionId) {
      return
    }
    this.sessionManager.resize(this.currentSessionId, cols, rows)
  }

  resizeTab(tabId: string, cols: number, rows: number): void {
    if (!this.currentSessionId) {
      return
    }
    this.sessionManager.resizeTab(this.currentSessionId, tabId, cols, rows)
  }

  disposeSession(tabId: string): void {
    if (!this.currentSessionId) {
      return
    }
    logDebug('backend.local.disposeSession', { sessionId: this.currentSessionId, tabId })
    this.sessionManager.closeTab(this.currentSessionId, tabId)
  }

  disposeAll(): void {
    if (!this.currentSessionId) {
      return
    }
    logDebug('backend.local.disposeAll', { sessionId: this.currentSessionId })
    this.sessionManager.disposeSession(this.currentSessionId)
  }

  destroy(keepSessions = true): void {
    logDebug('backend.local.destroy', { keepSessions, sessionId: this.currentSessionId })
    if (!keepSessions) {
      if (this.currentSessionId) {
        this.sessionManager.disposeSession(this.currentSessionId)
      }
    }
    this.currentSessionId = null
  }
}
