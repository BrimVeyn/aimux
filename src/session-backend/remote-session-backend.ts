import { EventEmitter } from 'node:events'
import { connect, Socket } from 'node:net'

import type { AssistantId, WorkspaceSnapshotV1 } from '../state/types'
import type { SessionBackend, SessionBackendEvents } from './types'

import { getDaemonSocketPath } from '../daemon/runtime-paths'
import { logDebug } from '../debug/input-log'
import {
  type AttachResult,
  type ClientRequest,
  encodeMessage,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  parseServerMessage,
  ProtocolMismatchError,
  type ServerEvent,
  type ServerResponse,
} from '../ipc/protocol'

const IPC_REQUEST_TIMEOUT_MS = 10_000

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

  private rejectPendingRequests(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
  }

  private resetConnection(reason: string): void {
    const socket = this.socket
    this.socket = null
    this.attached = false
    this.currentSessionId = null
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

  async attach(options: {
    sessionId: string
    cols: number
    rows: number
    workspaceSnapshot?: WorkspaceSnapshotV1
  }): Promise<AttachResult> {
    const socketPath = getDaemonSocketPath()
    logDebug('backend.remote.attach.start', {
      cols: options.cols,
      rows: options.rows,
      sessionId: options.sessionId,
      snapshotTabs: options.workspaceSnapshot?.tabs.length ?? 0,
      socketPath,
    })
    this.resetConnection('Connection replaced during attach')

    const socket = connect(socketPath)
    this.socket = socket
    this.attached = false
    this.currentSessionId = options.sessionId

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    logDebug('backend.remote.attach.connected', { socketPath })

    socket.on('error', (error) => {
      if (this.socket !== socket) {
        return
      }
      logDebug('backend.remote.socketError', { error: error.message })
      this.resetConnection(`Remote backend socket error: ${error.message}`)
    })
    socket.on('close', () => {
      if (this.socket !== socket) {
        return
      }
      logDebug('backend.remote.socketClose')
      this.resetConnection('Remote backend socket closed')
    })

    socket.on('data', (chunk) => {
      if (this.socket !== socket) {
        return
      }
      logDebug('backend.remote.data', { byteLength: chunk.length })
      try {
        for (const message of this.decoder.push(chunk)) {
          if ('id' in message) {
            logDebug('backend.remote.response', { id: message.id, type: message.type })
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
        logDebug('backend.remote.socketError', { error: message })
        this.resetConnection(`Remote backend parse error: ${message}`)
      }
    })

    const response = await this.send({
      id: crypto.randomUUID(),
      payload: { ...options, protocolVersion: IPC_PROTOCOL_VERSION },
      type: 'attach',
    })

    if (response.type !== 'attachResult') {
      logDebug('backend.remote.attach.unexpected', { type: response.type })
      this.resetConnection(`Unexpected attach response: ${response.type}`)
      throw new Error(
        response.type === 'error' ? response.payload.message : 'Unexpected attach response'
      )
    }

    if (response.payload.protocolVersion !== IPC_PROTOCOL_VERSION) {
      this.resetConnection(
        `Protocol mismatch: client v${IPC_PROTOCOL_VERSION}, daemon v${response.payload.protocolVersion}`
      )
      throw new ProtocolMismatchError(IPC_PROTOCOL_VERSION, response.payload.protocolVersion)
    }

    this.attached = true

    logDebug('backend.remote.attach.success', {
      activeTabId: response.payload.activeTabId,
      sessionId: options.sessionId,
      tabs: response.payload.tabs.length,
    })

    return response.payload
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

    logDebug('backend.remote.createSession', {
      sessionId: this.currentSessionId,
      tabId: options.tabId,
      title: options.title,
    })
    void this.sendExpectOk({ id: crypto.randomUUID(), payload: options, type: 'createTab' }).catch(
      (error) => this.reportCommandError('createTab', error, options.tabId)
    )
  }

  write(tabId: string, input: string): void {
    if (!this.attached) {
      logDebug('backend.remote.skipWriteBeforeAttach', { inputLength: input.length, tabId })
      return
    }
    logDebug('backend.remote.write', {
      inputLength: input.length,
      sessionId: this.currentSessionId,
      tabId,
    })
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
    logDebug('backend.remote.scroll', { deltaLines, sessionId: this.currentSessionId, tabId })
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
    logDebug('backend.remote.scrollToBottom', { sessionId: this.currentSessionId, tabId })
    void this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { tabId },
      type: 'scrollToBottom',
    }).catch((error) => this.reportCommandError('scrollToBottom', error, tabId))
  }

  setActiveTab(tabId: string | null): void {
    if (!this.attached) {
      return
    }
    logDebug('backend.remote.setActiveTab', { sessionId: this.currentSessionId, tabId })
    void this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { tabId },
      type: 'setActiveTab',
    }).catch((error) => this.reportCommandError('setActiveTab', error))
  }

  resizeAll(cols: number, rows: number): void {
    if (!this.attached) {
      logDebug('backend.remote.skipResizeBeforeAttach', { cols, rows })
      return
    }
    logDebug('backend.remote.resize', { cols, rows, sessionId: this.currentSessionId })
    void this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { cols, rows },
      type: 'resizeClient',
    }).catch((error) => this.reportCommandError('resizeClient', error))
  }

  resizeTab(tabId: string, cols: number, rows: number): void {
    if (!this.attached) {
      return
    }
    logDebug('backend.remote.resizeTab', { cols, rows, sessionId: this.currentSessionId, tabId })
    void this.sendExpectOk({
      id: crypto.randomUUID(),
      payload: { cols, rows, tabId },
      type: 'resizeTab',
    }).catch((error) => this.reportCommandError('resizeTab', error, tabId))
  }

  disposeSession(tabId: string): void {
    if (!this.attached) {
      return
    }
    logDebug('backend.remote.disposeSession', { sessionId: this.currentSessionId, tabId })
    void this.sendExpectOk({ id: crypto.randomUUID(), payload: { tabId }, type: 'closeTab' }).catch(
      (error) => this.reportCommandError('closeTab', error, tabId)
    )
  }

  disposeAll(): void {
    if (!this.attached) {
      return
    }
    logDebug('backend.remote.disposeAll', { sessionId: this.currentSessionId })
    void this.sendExpectOk({ id: crypto.randomUUID(), payload: {}, type: 'disposeAll' }).catch(
      (error) => this.reportCommandError('disposeAll', error)
    )
  }

  async destroy(keepSessions = true): Promise<void> {
    logDebug('backend.remote.destroy', { keepSessions })
    if (!keepSessions) {
      this.disposeAll()
    }
    this.resetConnection('Remote backend destroyed')
  }
}
