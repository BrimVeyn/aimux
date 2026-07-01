import { EventEmitter } from 'node:events'
import { connect, type Socket } from 'node:net'

import type { TerminalModeState, TerminalSnapshot, WorkspaceSnapshotV1 } from '../state/types'

import { getTerminalManagerSocketPath } from '../daemon/runtime-paths'
import { logDebug } from '../debug/input-log'
import {
  encodeManagerMessage,
  MANAGER_CAPABILITY_SET_BROADCAST_ENABLED,
  MANAGER_PROTOCOL_BROADCAST_GATE_VERSION,
  MANAGER_PROTOCOL_MIN_VERSION,
  MANAGER_PROTOCOL_VERSION,
  type ManagerAttachResult,
  type ManagerEvent,
  type ManagerRequest,
  type ManagerResponse,
  MessageDecoder,
  parseManagerMessage,
} from '../ipc/manager-protocol'

interface ManagerClientEvents {
  render: [
    sessionId: string,
    tabId: string,
    viewport: TerminalSnapshot,
    terminalModes: TerminalModeState,
  ]
  exit: [sessionId: string, tabId: string, exitCode: number]
  error: [sessionId: string, tabId: string, message: string]
}

const REQUEST_TIMEOUT_MS = 10_000

export class TerminalManagerClient extends EventEmitter<ManagerClientEvents> {
  private socket: Socket | null = null
  private readonly pending = new Map<
    string,
    {
      resolve: (message: ManagerResponse) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private readonly decoder = new MessageDecoder<ManagerResponse | ManagerEvent>(parseManagerMessage)
  private selectedProtocolVersion: number | null = null
  private serverCapabilities: ReadonlySet<string> = new Set()

  private rejectPendingRequests(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
  }

  private resetConnection(reason: string): void {
    logDebug('managerClient.resetConnection', { reason })
    const socket = this.socket
    this.socket = null
    this.selectedProtocolVersion = null
    this.serverCapabilities = new Set()
    this.decoder.reset()
    this.rejectPendingRequests(new Error(reason))

    if (!socket) {
      return
    }

    socket.removeAllListeners()
    if (!socket.destroyed) {
      socket.end()
      socket.destroy()
    }
  }

  private getConnectedSocket(): Socket {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Terminal manager socket is unavailable')
    }

    return this.socket
  }

  private async send(request: ManagerRequest): Promise<ManagerResponse> {
    const socket = this.getConnectedSocket()
    logDebug('managerClient.send', { id: request.id, type: request.type })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id)
        logDebug('managerClient.timeout', { id: request.id, type: request.type })
        reject(
          new Error(`Manager request timed out after ${REQUEST_TIMEOUT_MS}ms: ${request.type}`)
        )
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(request.id, { reject, resolve, timer })
      socket.write(encodeManagerMessage(request), (error) => {
        if (error) {
          clearTimeout(timer)
          this.pending.delete(request.id)
          logDebug('managerClient.sendError', {
            error: error.message,
            id: request.id,
            type: request.type,
          })
          reject(error)
        }
      })
    })
  }

  private async sendExpectOk(request: ManagerRequest): Promise<void> {
    const response = await this.send(request)
    if (response.type === 'ok') {
      return
    }

    throw new Error(
      response.type === 'error'
        ? response.payload.message
        : `Unexpected response for ${request.type}: ${response.type}`
    )
  }

  private handleManagerEvent(message: ManagerEvent): void {
    logDebug('managerClient.event', {
      sessionId: message.payload.sessionId,
      tabId: message.payload.tabId,
      type: message.type,
    })
    switch (message.type) {
      case 'tabRender':
        this.emit(
          'render',
          message.payload.sessionId,
          message.payload.tabId,
          message.payload.viewport,
          message.payload.terminalModes
        )
        break
      case 'tabExit':
        this.emit(
          'exit',
          message.payload.sessionId,
          message.payload.tabId,
          message.payload.exitCode
        )
        break
      case 'tabError':
        this.emit(
          'error',
          message.payload.sessionId,
          message.payload.tabId,
          message.payload.message
        )
        break
    }
  }

  private async performHandshake(): Promise<void> {
    logDebug('managerClient.handshake.start', {
      maxVersion: MANAGER_PROTOCOL_VERSION,
      minVersion: MANAGER_PROTOCOL_MIN_VERSION,
    })
    const response = await this.send({
      id: crypto.randomUUID(),
      payload: {
        maxVersion: MANAGER_PROTOCOL_VERSION,
        minVersion: MANAGER_PROTOCOL_MIN_VERSION,
      },
      type: 'hello',
    })

    if (response.type !== 'helloResult') {
      throw new Error(
        response.type === 'error' ? response.payload.message : 'Unexpected hello response'
      )
    }

    this.selectedProtocolVersion = response.payload.selectedVersion
    this.serverCapabilities = new Set(response.payload.capabilities)
    logDebug('managerClient.handshake.success', {
      capabilities: response.payload.capabilities,
      processVersion: response.payload.processVersion,
      selectedVersion: this.selectedProtocolVersion,
    })
  }

  async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed && this.selectedProtocolVersion !== null) {
      logDebug('managerClient.connect.reuse', {
        selectedProtocolVersion: this.selectedProtocolVersion,
      })
      return
    }

    this.resetConnection('Terminal manager connection replaced')

    logDebug('managerClient.connect.start', { socketPath: getTerminalManagerSocketPath() })
    const socket = connect(getTerminalManagerSocketPath())
    this.socket = socket

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })

    logDebug('managerClient.connect.connected', { socketPath: getTerminalManagerSocketPath() })

    socket.on('error', (error) => {
      if (this.socket !== socket) {
        return
      }
      logDebug('managerClient.socketError', { error: error.message })
      this.resetConnection(`Terminal manager socket error: ${error.message}`)
    })
    socket.on('close', () => {
      if (this.socket !== socket) {
        return
      }
      logDebug('managerClient.socketClose')
      this.resetConnection('Terminal manager socket closed')
    })
    socket.on('data', (chunk) => {
      if (this.socket !== socket) {
        return
      }

      try {
        for (const message of this.decoder.push(chunk)) {
          if ('id' in message) {
            logDebug('managerClient.response', { id: message.id, type: message.type })
            const pending = this.pending.get(message.id)
            if (pending) {
              clearTimeout(pending.timer)
              this.pending.delete(message.id)
              pending.resolve(message)
            }
          } else {
            this.handleManagerEvent(message)
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logDebug('managerClient.parseError', { error: message })
        this.resetConnection(`Terminal manager parse error: ${message}`)
      }
    })

    await this.performHandshake()
  }

  async attachSession(options: {
    sessionId: string
    cols: number
    rows: number
    workspaceSnapshot?: WorkspaceSnapshotV1
  }): Promise<ManagerAttachResult> {
    logDebug('managerClient.attach.start', {
      cols: options.cols,
      rows: options.rows,
      sessionId: options.sessionId,
      snapshotTabs: options.workspaceSnapshot?.tabs.length ?? 0,
    })
    await this.connect()
    const response = await this.send({
      id: crypto.randomUUID(),
      payload: {
        ...options,
        protocolVersion: this.selectedProtocolVersion ?? MANAGER_PROTOCOL_VERSION,
      },
      type: 'attachSession',
    })

    if (response.type !== 'attachResult') {
      throw new Error(
        response.type === 'error' ? response.payload.message : 'Unexpected attach response'
      )
    }

    logDebug('managerClient.attach.success', {
      activeTabId: response.payload.activeTabId,
      sessionId: options.sessionId,
      tabs: response.payload.tabs.length,
    })
    return response.payload
  }

  async createTab(
    options: Extract<ManagerRequest, { type: 'createTab' }>['payload']
  ): Promise<void> {
    logDebug('managerClient.createTab', {
      command: options.command,
      sessionId: options.sessionId,
      tabId: options.tabId,
      title: options.title,
    })
    return this.sendExpectOk({ id: crypto.randomUUID(), payload: options, type: 'createTab' })
  }

  async write(sessionId: string, tabId: string, data: string): Promise<void> {
    return this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { data, sessionId, tabId },
      type: 'write',
    })
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    return this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { cols, rows, sessionId },
      type: 'resizeClient',
    })
  }

  async resizeTab(sessionId: string, tabId: string, cols: number, rows: number): Promise<void> {
    return this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { cols, rows, sessionId, tabId },
      type: 'resizeTab',
    })
  }

  async scroll(sessionId: string, tabId: string, deltaLines: number): Promise<void> {
    return this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { deltaLines, sessionId, tabId },
      type: 'scroll',
    })
  }

  async scrollToBottom(sessionId: string, tabId: string): Promise<void> {
    return this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { sessionId, tabId },
      type: 'scrollToBottom',
    })
  }

  async setActiveTab(sessionId: string, tabId: string | null): Promise<void> {
    return this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { sessionId, tabId },
      type: 'setActiveTab',
    })
  }

  async closeTab(sessionId: string, tabId: string): Promise<void> {
    return this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { sessionId, tabId },
      type: 'closeTab',
    })
  }

  async disposeSession(sessionId: string): Promise<void> {
    return this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { sessionId },
      type: 'disposeSession',
    })
  }

  /**
   * Tell the TM whether to bother snapshotting and broadcasting renders.
   * Gated on the TM advertising `setBroadcastEnabled` in its hello
   * capabilities; TMs built before the capabilities field existed still get
   * the call when they speak protocol v≥4 (which is where the request
   * shipped). Below that, keep the pre-existing broadcast-always behaviour.
   */
  async setBroadcastEnabled(enabled: boolean): Promise<void> {
    const advertised = this.serverCapabilities.has(MANAGER_CAPABILITY_SET_BROADCAST_ENABLED)
    const versionImplies =
      this.selectedProtocolVersion !== null &&
      this.selectedProtocolVersion >= MANAGER_PROTOCOL_BROADCAST_GATE_VERSION
    if (!advertised && !versionImplies) {
      logDebug('managerClient.setBroadcastEnabled.skipped', {
        enabled,
        reason: 'capability-not-advertised',
        selectedVersion: this.selectedProtocolVersion,
      })
      return
    }
    await this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { enabled },
      type: 'setBroadcastEnabled',
    })
  }

  /**
   * The manager-protocol version negotiated with the running TM, or `null`
   * if no handshake has completed. Used by the daemon's helloResult so
   * bootstrap can decide whether a hot-reexec would land on a compatible TM.
   */
  getSelectedProtocolVersion(): number | null {
    return this.selectedProtocolVersion
  }

  destroy(): void {
    this.resetConnection('Terminal manager client destroyed')
  }
}
