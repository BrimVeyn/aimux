import { EventEmitter } from 'node:events'

import type { TerminalModeState, TerminalSnapshot, WorkspaceSnapshotV1 } from '../state/types'

import { logDebug } from '../debug/input-log'
import { SessionRegistry } from './session-registry'

type SessionManagerEvents = {
  render: [
    sessionId: string,
    tabId: string,
    viewport: TerminalSnapshot,
    terminalModes: TerminalModeState,
  ]
  exit: [sessionId: string, tabId: string, exitCode: number]
  error: [sessionId: string, tabId: string, message: string]
}

export class SessionManager extends EventEmitter<SessionManagerEvents> {
  private registries = new Map<string, SessionRegistry>()

  private getOrCreateRegistry(sessionId: string): SessionRegistry {
    const existing = this.registries.get(sessionId)
    if (existing) {
      return existing
    }

    const registry = new SessionRegistry()
    registry.on('render', (tabId, viewport, terminalModes) => {
      this.emit('render', sessionId, tabId, viewport, terminalModes)
    })
    registry.on('exit', (tabId, exitCode) => {
      this.emit('exit', sessionId, tabId, exitCode)
    })
    registry.on('error', (tabId, message) => {
      this.emit('error', sessionId, tabId, message)
    })
    this.registries.set(sessionId, registry)
    return registry
  }

  attachSession(sessionId: string, snapshot?: WorkspaceSnapshotV1) {
    logDebug('daemon.sessionManager.attachSession', {
      hasSnapshot: !!snapshot,
      sessionId,
      snapshotTabs: snapshot?.tabs.length ?? 0,
    })
    return this.getOrCreateRegistry(sessionId).attachFromSnapshot(snapshot)
  }

  createTab(sessionId: string, options: Parameters<SessionRegistry['createSession']>[0]): void {
    logDebug('daemon.sessionManager.createTab', {
      command: options.command,
      sessionId,
      tabId: options.tabId,
      title: options.title,
    })
    this.getOrCreateRegistry(sessionId).createSession(options)
  }

  write(sessionId: string, tabId: string, data: string): void {
    this.getOrCreateRegistry(sessionId).write(tabId, data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.getOrCreateRegistry(sessionId).resizeAll(cols, rows)
  }

  resizeTab(sessionId: string, tabId: string, cols: number, rows: number): void {
    this.getOrCreateRegistry(sessionId).resizeTab(tabId, cols, rows)
  }

  scroll(sessionId: string, tabId: string, deltaLines: number): void {
    this.getOrCreateRegistry(sessionId).scrollViewport(tabId, deltaLines)
  }

  scrollToBottom(sessionId: string, tabId: string): void {
    this.getOrCreateRegistry(sessionId).scrollViewportToBottom(tabId)
  }

  setActiveTab(sessionId: string, tabId: string | null): void {
    this.getOrCreateRegistry(sessionId).setActiveTab(tabId)
  }

  closeTab(sessionId: string, tabId: string): void {
    this.getOrCreateRegistry(sessionId).closeTab(tabId)
  }

  disposeSession(sessionId: string): void {
    logDebug('daemon.sessionManager.disposeSession', {
      hadRegistry: this.registries.has(sessionId),
      sessionId,
    })
    const registry = this.registries.get(sessionId)
    if (!registry) {
      return
    }
    registry.disposeAll()
    this.registries.delete(sessionId)
  }

  disposeAll(): void {
    logDebug('daemon.sessionManager.disposeAll', { sessionCount: this.registries.size })
    for (const registry of this.registries.values()) {
      registry.disposeAll()
    }
    this.registries.clear()
  }
}
