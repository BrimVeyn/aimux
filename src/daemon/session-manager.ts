import { EventEmitter } from 'node:events'

import type {
  TabSession,
  TerminalModeState,
  TerminalSnapshot,
  WorkspaceSnapshotV1,
} from '../state/types'

import { logDebug } from '../debug/input-log'
import { SessionRegistry } from './session-registry'

interface SessionManagerEvents {
  render: [
    projectId: string,
    tabId: string,
    viewport: TerminalSnapshot,
    terminalModes: TerminalModeState,
  ]
  exit: [projectId: string, tabId: string, exitCode: number]
  error: [projectId: string, tabId: string, message: string]
}

export class SessionManager extends EventEmitter<SessionManagerEvents> {
  private registries = new Map<string, SessionRegistry>()

  private getOrCreateRegistry(projectId: string): SessionRegistry {
    const existing = this.registries.get(projectId)
    if (existing) {
      return existing
    }

    const registry = new SessionRegistry()
    registry.on('render', (tabId, viewport, terminalModes) => {
      this.emit('render', projectId, tabId, viewport, terminalModes)
    })
    registry.on('exit', (tabId, exitCode) => {
      this.emit('exit', projectId, tabId, exitCode)
    })
    registry.on('error', (tabId, message) => {
      this.emit('error', projectId, tabId, message)
    })
    this.registries.set(projectId, registry)
    return registry
  }

  attachSession(projectId: string, snapshot?: WorkspaceSnapshotV1) {
    logDebug('daemon.sessionManager.attachSession', {
      hasSnapshot: !!snapshot,
      projectId,
      snapshotTabs: snapshot?.tabs.length ?? 0,
    })
    return this.getOrCreateRegistry(projectId).attachFromSnapshot(snapshot)
  }

  createTab(projectId: string, options: Parameters<SessionRegistry['createSession']>[0]): void {
    logDebug('daemon.sessionManager.createTab', {
      command: options.command,
      projectId,
      tabId: options.tabId,
      title: options.title,
    })
    this.getOrCreateRegistry(projectId).createSession(options)
  }

  write(projectId: string, tabId: string, data: string): void {
    this.getOrCreateRegistry(projectId).write(tabId, data)
  }

  updateTabMetadata(
    projectId: string,
    tabId: string,
    patch: { title?: string; autoRenameStatus?: 'eligible' | 'attempted' }
  ): void {
    this.getOrCreateRegistry(projectId).updateTabMetadata(tabId, patch)
  }

  resize(projectId: string, cols: number, rows: number, options?: { sync?: boolean }): void {
    this.getOrCreateRegistry(projectId).resizeAll(cols, rows, options)
  }

  resizeTab(
    projectId: string,
    tabId: string,
    cols: number,
    rows: number,
    options?: { sync?: boolean }
  ): void {
    this.getOrCreateRegistry(projectId).resizeTab(tabId, cols, rows, options)
  }

  scroll(projectId: string, tabId: string, deltaLines: number): void {
    this.getOrCreateRegistry(projectId).scrollViewport(tabId, deltaLines)
  }

  scrollToBottom(projectId: string, tabId: string): void {
    this.getOrCreateRegistry(projectId).scrollViewportToBottom(tabId)
  }

  setActiveTab(projectId: string, tabId: string | null): void {
    this.getOrCreateRegistry(projectId).setActiveTab(tabId)
  }

  closeTab(projectId: string, tabId: string): void {
    this.getOrCreateRegistry(projectId).closeTab(tabId)
  }

  disposeSession(projectId: string): void {
    logDebug('daemon.sessionManager.disposeSession', {
      hadRegistry: this.registries.has(projectId),
      projectId,
    })
    const registry = this.registries.get(projectId)
    if (!registry) {
      return
    }
    registry.disposeAll()
    this.registries.delete(projectId)
  }

  disposeAll(): void {
    logDebug('daemon.sessionManager.disposeAll', { sessionCount: this.registries.size })
    for (const registry of this.registries.values()) {
      registry.disposeAll()
    }
    this.registries.clear()
  }

  setBroadcastEnabled(enabled: boolean): void {
    for (const registry of this.registries.values()) {
      registry.setBroadcastEnabled(enabled)
    }
  }

  hasAnySessions(): boolean {
    for (const registry of this.registries.values()) {
      if (registry.hasSessions()) return true
    }
    return false
  }

  listSessionIds(): string[] {
    return [...this.registries.keys()]
  }

  listTabs(projectId: string): TabSession[] {
    return this.registries.get(projectId)?.listTabs() ?? []
  }
}
