import { EventEmitter } from 'node:events'
import { connect, Socket } from 'node:net'

import type { AssistantId, ScrollIntent, WorkspaceSnapshotV1 } from '../state/types'
import type { SessionBackend, SessionBackendEvents } from './types'

import { getIpcDaemonSocketPath } from '../daemon/runtime-paths'
import { logDebug } from '../debug/input-log'
import {
  type AttachResult,
  type ClientRequest,
  encodeMessage,
  IPC_PROTOCOL_MIN_VERSION,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  parseServerMessage,
  ProtocolMismatchError,
  type ServerEvent,
  type ServerResponse,
} from '../ipc/protocol'

const IPC_REQUEST_TIMEOUT_MS = 10_000
const RECONNECT_DELAY_MS = 250

export class RemoteSessionBackend
  extends EventEmitter<SessionBackendEvents>
  implements SessionBackend
{
  private socket: Socket | null = null
  private readonly pending = new Map<
    string,
    {
      resolve: (message: ServerResponse) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private decoder = new MessageDecoder<ServerResponse | ServerEvent>(parseServerMessage)
  private attached = false
  private currentSessionId: string | null = null
  private attachOptions: {
    sessionId: string
    cols: number
    rows: number
    workspaceSnapshot?: WorkspaceSnapshotV1
  } | null = null
  private selectedProtocolVersion: number | null = null
  private reconnectPromise: Promise<void> | null = null
  private shouldReconnect = false

  private rejectPendingRequests(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
  }

  private closeSocket(reason: string, preserveSession = false): void {
    const socket = this.socket
    this.socket = null
    this.attached = false
    this.selectedProtocolVersion = null
    this.decoder.reset()
    this.rejectPendingRequests(new Error(reason))

    if (!preserveSession) {
      this.currentSessionId = null
      this.attachOptions = null
    }

    if (!socket) {
      return
    }

    socket.removeAllListeners()
    if (!socket.destroyed) {
      socket.end()
      socket.destroy()
    }
  }

  private handleConnectionLoss(reason: string): void {
    logDebug('backend.remote.connectionLoss', { reason, sessionId: this.currentSessionId })
    this.closeSocket(reason, true)
    if (this.shouldReconnect && this.attachOptions) {
      void this.scheduleReconnect()
    }
  }

  private getConnectedSocket(): Socket {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Remote backend socket is unavailable')
    }

    return this.socket
  }

  private send(request: ClientRequest): Promise<ServerResponse> {
    const socket = this.getConnectedSocket()
    logDebug('backend.remote.send', { id: request.id, type: request.type })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id)
        logDebug('backend.remote.timeout', { id: request.id, type: request.type })
        reject(
          new Error(`IPC request timed out after ${IPC_REQUEST_TIMEOUT_MS}ms: ${request.type}`)
        )
      }, IPC_REQUEST_TIMEOUT_MS)
      this.pending.set(request.id, { reject, resolve, timer })
      socket.write(encodeMessage(request), (error) => {
        if (error) {
          clearTimeout(timer)
          this.pending.delete(request.id)
          logDebug('backend.remote.sendError', {
            error: error.message,
            id: request.id,
            type: request.type,
          })
          reject(error)
        }
      })
    })
  }

  private async sendExpectOk(request: ClientRequest): Promise<void> {
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

  private reportCommandError(context: string, error: unknown, tabId?: string): void {
    const message = error instanceof Error ? error.message : String(error)
    logDebug('backend.remote.commandError', { context, error: message, tabId })
    if (tabId) {
      this.emit('error', tabId, message)
    }
  }

  private handleServerEvent(message: ServerEvent): void {
    logDebug('backend.remote.event', { type: message.type })
    switch (message.type) {
      case 'tabRender':
        this.emit(
          'render',
          message.payload.tabId,
          message.payload.viewport,
          message.payload.terminalModes
        )
        break
      case 'tabExit':
        this.emit('exit', message.payload.tabId, message.payload.exitCode)
        break
      case 'tabError':
        this.emit('error', message.payload.tabId, message.payload.message)
        break
    }
  }

  private async connectAndHandshake(): Promise<void> {
    const socketPath = getIpcDaemonSocketPath()
    this.closeSocket('Connection replaced during attach', true)

    const socket = connect(socketPath)
    this.socket = socket

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })

    socket.on('error', (error) => {
      if (this.socket !== socket) {
        return
      }
      this.handleConnectionLoss(`Remote backend socket error: ${error.message}`)
    })
    socket.on('close', () => {
      if (this.socket !== socket) {
        return
      }
      this.handleConnectionLoss('Remote backend socket closed')
    })
    socket.on('data', (chunk) => {
      if (this.socket !== socket) {
        return
      }
      try {
        for (const message of this.decoder.push(chunk)) {
          if ('id' in message) {
            const pending = this.pending.get(message.id)
            if (pending) {
              clearTimeout(pending.timer)
              this.pending.delete(message.id)
              pending.resolve(message)
            }
          } else {
            this.handleServerEvent(message)
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.handleConnectionLoss(`Remote backend parse error: ${message}`)
      }
    })

    const response = await this.send({
      id: crypto.randomUUID(),
      payload: { maxVersion: IPC_PROTOCOL_VERSION, minVersion: IPC_PROTOCOL_MIN_VERSION },
      type: 'hello',
    })

    if (response.type !== 'helloResult') {
      this.closeSocket('Unexpected hello response', true)
      throw new Error(
        response.type === 'error' ? response.payload.message : 'Unexpected hello response'
      )
    }

    this.selectedProtocolVersion = response.payload.selectedVersion
  }

  private async performAttach(options: {
    sessionId: string
    cols: number
    rows: number
    workspaceSnapshot?: WorkspaceSnapshotV1
  }): Promise<AttachResult> {
    await this.connectAndHandshake()

    const response = await this.send({
      id: crypto.randomUUID(),
      payload: {
        ...options,
        protocolVersion: this.selectedProtocolVersion ?? IPC_PROTOCOL_VERSION,
      },
      type: 'attach',
    })

    if (response.type !== 'attachResult') {
      this.closeSocket(`Unexpected attach response: ${response.type}`, true)
      throw new Error(
        response.type === 'error' ? response.payload.message : 'Unexpected attach response'
      )
    }

    if (response.payload.protocolVersion !== this.selectedProtocolVersion) {
      this.closeSocket('Attach protocol mismatch', true)
      throw new ProtocolMismatchError(
        this.selectedProtocolVersion ?? IPC_PROTOCOL_VERSION,
        response.payload.protocolVersion
      )
    }

    this.attached = true
    return response.payload
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnectPromise) {
      return this.reconnectPromise
    }

    const reconnectOptions = this.attachOptions
    this.reconnectPromise = (async () => {
      while (this.shouldReconnect && reconnectOptions && this.attachOptions === reconnectOptions) {
        try {
          await this.performAttach(reconnectOptions)
          logDebug('backend.remote.reconnect.success', {
            sessionId: reconnectOptions.sessionId,
          })
          return
        } catch (error) {
          logDebug('backend.remote.reconnect.retry', {
            error: error instanceof Error ? error.message : String(error),
            sessionId: reconnectOptions.sessionId,
          })
          await Bun.sleep(RECONNECT_DELAY_MS)
        }
      }
    })()

    try {
      await this.reconnectPromise
    } finally {
      this.reconnectPromise = null
    }
  }

  async attach(options: {
    sessionId: string
    cols: number
    rows: number
    workspaceSnapshot?: WorkspaceSnapshotV1
  }): Promise<AttachResult> {
    this.shouldReconnect = true
    this.currentSessionId = options.sessionId
    this.attachOptions = options

    logDebug('backend.remote.attach.start', {
      cols: options.cols,
      rows: options.rows,
      sessionId: options.sessionId,
      snapshotTabs: options.workspaceSnapshot?.tabs.length ?? 0,
      socketPath: getIpcDaemonSocketPath(),
    })

    const result = await this.performAttach(options)
    logDebug('backend.remote.attach.success', {
      activeTabId: result.activeTabId,
      sessionId: options.sessionId,
      tabs: result.tabs.length,
    })

    return result
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
    if (!this.attached) {
      logDebug('backend.remote.skipCreateBeforeAttach', { tabId: options.tabId })
      return
    }

    void this.sendExpectOk({ id: crypto.randomUUID(), payload: options, type: 'createTab' }).catch(
      (error) => this.reportCommandError('createTab', error, options.tabId)
    )
  }

  write(tabId: string, input: string): void {
    if (!this.attached) {
      logDebug('backend.remote.skipWriteBeforeAttach', { inputLength: input.length, tabId })
      return
    }
    void this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { data: input, tabId },
      type: 'write',
    }).catch((error) => this.reportCommandError('write', error, tabId))
  }

  scrollViewport(tabId: string, deltaLines: number): void {
    if (!this.attached) {
      return
    }
    void this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { deltaLines, tabId },
      type: 'scroll',
    }).catch((error) => this.reportCommandError('scroll', error, tabId))
  }

  scrollViewportToBottom(tabId: string): void {
    if (!this.attached) {
      return
    }
    void this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { tabId },
      type: 'scrollToBottom',
    }).catch((error) => this.reportCommandError('scrollToBottom', error, tabId))
  }

  reapplyScrollIntent(tabId: string, intent: ScrollIntent): void {
    if (!this.attached) {
      return
    }
    void this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { intent, tabId },
      type: 'reapplyScrollIntent',
    }).catch((error) => this.reportCommandError('reapplyScrollIntent', error, tabId))
  }

  setActiveTab(tabId: string | null): void {
    if (!this.attached) {
      return
    }
    void this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { tabId },
      type: 'setActiveTab',
    }).catch((error) => this.reportCommandError('setActiveTab', error))
  }

  resizeAll(cols: number, rows: number, intents?: Map<string, ScrollIntent>): void {
    if (!this.attached) {
      logDebug('backend.remote.skipResizeBeforeAttach', { cols, rows })
      return
    }
    logDebug('backend.remote.resize', { cols, rows, sessionId: this.currentSessionId })
    const intentsRecord = intents ? Object.fromEntries(intents.entries()) : undefined
    void this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { cols, intents: intentsRecord, rows },
      type: 'resizeClient',
    }).catch((error) => this.reportCommandError('resizeClient', error))
  }

  resizeTab(tabId: string, cols: number, rows: number, intent?: ScrollIntent): void {
    if (!this.attached) {
      return
    }
    void this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { cols, intent, rows, tabId },
      type: 'resizeTab',
    }).catch((error) => this.reportCommandError('resizeTab', error, tabId))
  }

  disposeSession(tabId: string): void {
    if (!this.attached) {
      return
    }
    void this.sendExpectOk({ id: crypto.randomUUID(), payload: { tabId }, type: 'closeTab' }).catch(
      (error) => this.reportCommandError('closeTab', error, tabId)
    )
  }

  disposeAll(): void {
    if (!this.attached) {
      return
    }
    void this.sendExpectOk({ id: crypto.randomUUID(), payload: {}, type: 'disposeAll' }).catch(
      (error) => this.reportCommandError('disposeAll', error)
    )
  }

  async destroy(keepSessions = true): Promise<void> {
    logDebug('backend.remote.destroy', { keepSessions })
    this.shouldReconnect = false
    this.reconnectPromise = null
    if (!keepSessions && this.attached) {
      this.disposeAll()
    }
    this.closeSocket('Remote backend destroyed')
  }
}
