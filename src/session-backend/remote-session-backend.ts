import { EventEmitter } from 'node:events'
import { connect, type Socket } from 'node:net'

import type { AssistantId, ProjectSnapshotV1 } from '../state/types'
import type { ProjectBackendEvents, ResizeOptions, SessionBackend } from './types'

import { getIpcDaemonSocketPath } from '../daemon/runtime-paths'
import { logDebug } from '../debug/input-log'
import {
  type AttachResult,
  type ClientRequest,
  encodeMessage,
  IPC_CAPABILITY_BYTE_STREAM,
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

export interface RemoteSessionBackendOptions {
  /**
   * If true, automatically opt into the raw PTY byte stream after every
   * successful attach (including reconnects). Required for the GUI host so
   * xterm.js gets live updates; the TUI leaves it false and consumes render
   * snapshots only.
   */
  streamBytes?: boolean
}

export class RemoteSessionBackend
  extends EventEmitter<ProjectBackendEvents>
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
  private currentProjectId: string | null = null
  private attachOptions: {
    projectId: string
    cols: number
    rows: number
    projectSnapshot?: ProjectSnapshotV1
  } | null = null
  private selectedProtocolVersion: number | null = null
  private daemonCapabilities: ReadonlySet<string> = new Set()
  private reconnectPromise: Promise<void> | null = null
  private shouldReconnect = false
  private readonly streamBytes: boolean

  constructor(options: RemoteSessionBackendOptions = {}) {
    super()
    this.streamBytes = options.streamBytes ?? false
  }

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

  private closeSocket(reason: string, preserveProject = false): void {
    const socket = this.socket
    this.socket = null
    this.attached = false
    this.selectedProtocolVersion = null
    this.daemonCapabilities = new Set()
    this.decoder.reset()
    this.rejectPendingRequests(new Error(reason))

    if (!preserveProject) {
      this.currentProjectId = null
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
    logDebug('backend.remote.connectionLoss', { projectId: this.currentProjectId, reason })
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
      case 'tabBytes':
        this.emit('bytes', message.payload.tabId, message.payload.data)
        break
      case 'tabExit':
        this.emit('exit', message.payload.tabId, message.payload.exitCode)
        break
      case 'tabError':
        this.emit('error', message.payload.tabId, message.payload.message)
        break
      case 'tabStatus':
        logDebug('backend.remote.tabStatus', {
          projectId: message.payload.projectId,
          status: message.payload.status,
          tabId: message.payload.tabId,
        })
        this.emit(
          'tabActivity',
          message.payload.tabId,
          message.payload.status,
          message.payload.workspaceId
        )
        break
      case 'tabTurnComplete':
        this.emit(
          'tabTurnComplete',
          message.payload.tabId,
          message.payload.projectId,
          message.payload.workspaceId
        )
        break
      case 'tabQuestion':
        // v13 orchestration signal — consumed by the headless CLI, not the UI
        // backend. Enumerated so the switch stays exhaustive.
        break
      case 'projectStatus':
        logDebug('backend.remote.projectStatus', {
          projectId: message.payload.projectId,
          status: message.payload.status,
        })
        this.emit('projectActivity', message.payload.projectId, message.payload.status)
        break
      case 'tabAdded':
        logDebug('backend.remote.tabAdded', {
          projectId: message.payload.projectId,
          tabId: message.payload.tab.id,
        })
        this.emit('tabAdded', message.payload.projectId, message.payload.tab)
        break
      case 'tabMetadataUpdated':
        this.emit('tabMetadataUpdated', message.payload.projectId, message.payload.tabId, {
          autoRenameStatus: message.payload.autoRenameStatus,
          title: message.payload.title,
        })
        break
      case 'projectCreateRequested':
        this.emit(
          'projectCreateRequested',
          message.payload.name,
          message.payload.projectPath,
          message.payload.switch === true
        )
        break
      case 'projectSwitchRequested':
        this.emit('projectSwitchRequested', message.payload.targetProjectId)
        break
      case 'projectCloseRequested':
        this.emit('projectCloseRequested', message.payload.targetProjectId)
        break
      case 'projectSwitched':
        this.emit('projectSwitched', message.payload.projectId)
        break
      case 'workspaceAdded':
        this.emit('workspaceAdded', message.payload.projectId, message.payload.workspace)
        break
      case 'workspaceRemoved':
        this.emit('workspaceRemoved', message.payload.projectId, message.payload.workspaceId)
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
    projectId: string
    cols: number
    rows: number
    projectSnapshot?: ProjectSnapshotV1
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
    if (this.streamBytes) {
      // Fire-and-forget: re-arm the byte subscription after every attach so
      // reconnects (daemon restart, socket flap) restore the live stream
      // without the host having to remember to call setBytesEnabled again.
      void this.setBytesEnabled(true)
    }
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
            projectId: reconnectOptions.projectId,
          })
          return
        } catch (error) {
          logDebug('backend.remote.reconnect.retry', {
            error: error instanceof Error ? error.message : String(error),
            projectId: reconnectOptions.projectId,
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
    projectId: string
    cols: number
    rows: number
    projectSnapshot?: ProjectSnapshotV1
  }): Promise<AttachResult> {
    this.shouldReconnect = true
    this.currentProjectId = options.projectId
    this.attachOptions = options

    logDebug('backend.remote.attach.start', {
      cols: options.cols,
      projectId: options.projectId,
      rows: options.rows,
      snapshotTabs: options.projectSnapshot?.tabs.length ?? 0,
      socketPath: getIpcDaemonSocketPath(),
    })

    const result = await this.performAttach(options)
    logDebug('backend.remote.attach.success', {
      activeTabId: result.activeTabId,
      projectId: options.projectId,
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
    workspaceId?: string
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

  async serializeBuffer(tabId: string): Promise<string> {
    if (!this.attached || !this.daemonAdvertises(IPC_CAPABILITY_BYTE_STREAM)) return ''
    try {
      const response = await this.send({
        id: crypto.randomUUID(),
        payload: { tabId },
        type: 'serializeBuffer',
      })
      if (response.type !== 'serializeBufferResult') {
        logDebug('backend.remote.serializeBuffer.unexpected', { type: response.type })
        return ''
      }
      return response.payload.data
    } catch (error) {
      logDebug('backend.remote.serializeBuffer.error', {
        error: error instanceof Error ? error.message : String(error),
        tabId,
      })
      return ''
    }
  }

  /**
   * Opt into the raw PTY byte stream. The GUI host calls this after attach
   * so xterm.js gets live updates; the TUI never calls it and the daemon
   * skips wire forwarding entirely (per-client subscription).
   */
  async setBytesEnabled(enabled: boolean): Promise<void> {
    if (!this.attached || !this.daemonAdvertises(IPC_CAPABILITY_BYTE_STREAM)) return
    try {
      await this.sendExpectOk({
        id: crypto.randomUUID(),
        payload: { enabled },
        type: 'setBytesEnabled',
      })
    } catch (error) {
      this.reportCommandError('setBytesEnabled', error)
    }
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
    logDebug('backend.remote.resize', { cols, projectId: this.currentProjectId, rows })
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

  announceProjectSwitched(projectId: string): void {
    // Fire-and-forget so `handleSwitchProjectEffect` doesn't block waiting on
    // the daemon roundtrip. The daemon relays this as a `projectSwitched`
    // broadcast that unblocks any `aimux project switch --wait` CLI.
    this.dispatchCommand(
      {
        id: crypto.randomUUID(),
        payload: { projectId },
        type: 'announceProjectSwitched',
      },
      'announceProjectSwitched'
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
