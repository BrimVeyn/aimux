import { EventEmitter } from 'node:events'
import { connect, type Socket } from 'node:net'

import type { AssistantId, WorkspaceSnapshotV1 } from '../state/types'
import type { ResizeOptions, SessionBackend, SessionBackendEvents } from './types'

import { getIpcDaemonSocketPath } from '../daemon/runtime-paths'
import { logDebug } from '../debug/input-log'
import {
  type AttachResult,
  type ClientRequest,
  encodeMessage,
  IPC_CAPABILITY_TAB_METADATA,
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
  private daemonCapabilities: ReadonlySet<string> = new Set()
  private reconnectPromise: Promise<void> | null = null
  private shouldReconnect = false

  /**
   * Capability strings advertised by the connected daemon on the last
   * successful `hello`. Empty before the first handshake completes, and
   * reset on connection loss. Callers should gate optional features on
   * `daemonAdvertises('...')` rather than on the negotiated version number.
   */
  daemonAdvertises(capability: string): boolean {
    return this.daemonCapabilities.has(capability)
  }

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
    this.daemonCapabilities = new Set()
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

  private async send(request: ClientRequest): Promise<ServerResponse> {
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
    if (tabId != null && tabId !== '') {
      this.emit('error', tabId, message)
    }
  }

  /** Fire-and-forget a command, reporting any failure via reportCommandError. */
  private dispatchCommand(request: ClientRequest, context: string, tabId?: string): void {
    void (async () => {
      try {
        await this.sendExpectOk(request)
      } catch (error) {
        this.reportCommandError(context, error, tabId)
      }
    })()
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
      case 'tabStatus':
        logDebug('backend.remote.tabStatus', {
          sessionId: message.payload.sessionId,
          status: message.payload.status,
          tabId: message.payload.tabId,
        })
        this.emit('tabActivity', message.payload.tabId, message.payload.status)
        break
      case 'tabTurnComplete':
      case 'tabQuestion':
        // v13 orchestration signals — consumed by the headless CLI, not the UI
        // backend. Enumerated so the switch stays exhaustive; no UI wiring yet.
        break
      case 'sessionStatus':
        logDebug('backend.remote.sessionStatus', {
          sessionId: message.payload.sessionId,
          status: message.payload.status,
        })
        this.emit('sessionActivity', message.payload.sessionId, message.payload.status)
        break
      case 'tabAdded':
        logDebug('backend.remote.tabAdded', {
          sessionId: message.payload.sessionId,
          tabId: message.payload.tab.id,
        })
        this.emit('tabAdded', message.payload.sessionId, message.payload.tab)
        break
      case 'tabMetadataUpdated':
        this.emit('tabMetadataUpdated', message.payload.sessionId, message.payload.tabId, {
          autoRenameStatus: message.payload.autoRenameStatus,
          title: message.payload.title,
        })
        break
      case 'workspaceCreateRequested':
        this.emit(
          'workspaceCreateRequested',
          message.payload.name,
          message.payload.projectPath,
          message.payload.switch === true
        )
        break
      case 'workspaceSwitchRequested':
        this.emit('workspaceSwitchRequested', message.payload.targetSessionId)
        break
      case 'workspaceCloseRequested':
        this.emit('workspaceCloseRequested', message.payload.targetSessionId)
        break
      case 'workspaceSwitched':
        this.emit('workspaceSwitched', message.payload.sessionId)
        break
      case 'worktreeAdded':
        this.emit('worktreeAdded', message.payload.sessionId, message.payload.worktree)
        break
      case 'worktreeRemoved':
        this.emit('worktreeRemoved', message.payload.sessionId, message.payload.worktreeId)
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
    this.daemonCapabilities = new Set(response.payload.capabilities)
    logDebug('backend.remote.hello.success', {
      capabilities: response.payload.capabilities,
      processVersion: response.payload.processVersion,
      selectedVersion: response.payload.selectedVersion,
    })
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
    worktreeId?: string
    autoRenameCandidate?: boolean
  }): void {
    if (!this.attached) {
      logDebug('backend.remote.skipCreateBeforeAttach', { tabId: options.tabId })
      return
    }

    this.dispatchCommand(
      { id: crypto.randomUUID(), payload: options, type: 'createTab' },
      'createTab',
      options.tabId
    )
  }

  write(tabId: string, input: string): void {
    if (!this.attached) {
      logDebug('backend.remote.skipWriteBeforeAttach', { inputLength: input.length, tabId })
      return
    }
    this.dispatchCommand(
      { id: crypto.randomUUID(), payload: { data: input, tabId }, type: 'write' },
      'write',
      tabId
    )
  }

  renameTab(tabId: string, title: string): void {
    if (!this.attached || !this.daemonAdvertises(IPC_CAPABILITY_TAB_METADATA)) return
    this.dispatchCommand(
      { id: crypto.randomUUID(), payload: { tabId, title }, type: 'renameTab' },
      'renameTab',
      tabId
    )
  }

  scrollViewport(tabId: string, deltaLines: number): void {
    if (!this.attached) {
      return
    }
    this.dispatchCommand(
      { id: crypto.randomUUID(), payload: { deltaLines, tabId }, type: 'scroll' },
      'scroll',
      tabId
    )
  }

  scrollViewportToBottom(tabId: string): void {
    if (!this.attached) {
      return
    }
    this.dispatchCommand(
      { id: crypto.randomUUID(), payload: { tabId }, type: 'scrollToBottom' },
      'scrollToBottom',
      tabId
    )
  }

  setActiveTab(tabId: string | null): void {
    if (!this.attached) {
      return
    }
    this.dispatchCommand(
      { id: crypto.randomUUID(), payload: { tabId }, type: 'setActiveTab' },
      'setActiveTab'
    )
  }

  resizeAll(cols: number, rows: number, _options?: ResizeOptions): void {
    if (!this.attached) {
      logDebug('backend.remote.skipResizeBeforeAttach', { cols, rows })
      return
    }
    logDebug('backend.remote.resize', { cols, rows, sessionId: this.currentSessionId })
    this.dispatchCommand(
      { id: crypto.randomUUID(), payload: { cols, rows }, type: 'resizeClient' },
      'resizeClient'
    )
  }

  // The remote backend forwards every resize over IPC; the daemon-side
  // pty-manager is the authoritative emulator. `confirmedFromMeasurement` is
  // not yet plumbed through the wire protocol — the local backend uses it to
  // gate the per-tab render emission, but in the remote path the daemon emits
  // snapshots based on its own emulator state, so the flag is intentionally
  // ignored here. If the boot-time visual desync ever shows up against a
  // daemon, plumb the flag through the resizeTab IPC message.
  resizeTab(tabId: string, cols: number, rows: number, _options?: ResizeOptions): void {
    if (!this.attached) {
      return
    }
    this.dispatchCommand(
      { id: crypto.randomUUID(), payload: { cols, rows, tabId }, type: 'resizeTab' },
      'resizeTab',
      tabId
    )
  }

  disposeSession(tabId: string): void {
    if (!this.attached) {
      return
    }
    this.dispatchCommand(
      { id: crypto.randomUUID(), payload: { tabId }, type: 'closeTab' },
      'closeTab',
      tabId
    )
  }

  disposeAll(): void {
    if (!this.attached) {
      return
    }
    this.dispatchCommand({ id: crypto.randomUUID(), payload: {}, type: 'disposeAll' }, 'disposeAll')
  }

  announceWorkspaceSwitched(sessionId: string): void {
    // Fire-and-forget so `handleSwitchSessionEffect` doesn't block waiting on
    // the daemon roundtrip. The daemon relays this as a `workspaceSwitched`
    // broadcast that unblocks any `aimux workspace switch --wait` CLI.
    this.dispatchCommand(
      {
        id: crypto.randomUUID(),
        payload: { sessionId },
        type: 'announceWorkspaceSwitched',
      },
      'announceWorkspaceSwitched'
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
