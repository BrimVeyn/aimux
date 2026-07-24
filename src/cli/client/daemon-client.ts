import { connect, type Socket } from 'node:net'

import {
  type AttachRequest,
  type AttachResult,
  type ClientRequest,
  encodeMessage,
  IPC_PROTOCOL_MIN_VERSION,
  IPC_PROTOCOL_VERSION,
  type ListTabsResult,
  MessageDecoder,
  parseServerMessage,
  type ProtocolHelloResult,
  type ServerEvent,
  type ServerResponse,
} from '../../ipc/protocol'

interface PendingRequest {
  resolve: (response: ServerResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type ServerEventType = ServerEvent['type']

type EventHandler<T extends ServerEventType> = (
  payload: Extract<ServerEvent, { type: T }>['payload']
) => void

const REQUEST_TIMEOUT_MS = 10_000

/**
 * Thin daemon-side client used by the CLI. Mirrors the UI's `IpcClient` but
 * trimmed down: no React store wiring, no presence tracking, no auto-reconnect
 * loop — the CLI is one-shot. The connection lives only as long as the
 * command runs.
 *
 * Capability checks are exposed so command implementations can gate on
 * `listTabs` / `thinAttach` / `createTabSizeFallback` and fall back cleanly
 * when the daemon predates v11.
 */
export class DaemonClient {
  private constructor(
    private readonly socket: Socket,
    private readonly hello: ProtocolHelloResult,
    private readonly pending: Map<string, PendingRequest>,
    private readonly eventHandlers: Map<
      ServerEventType,
      Set<(payload: ServerEvent['payload']) => void>
    >
  ) {}

  static async connect(socketPath: string): Promise<DaemonClient> {
    const socket = connect(socketPath)
    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        socket.off('error', onError)
        resolve()
      }
      const onError = (error: Error) => {
        socket.off('connect', onConnect)
        reject(error)
      }
      socket.once('connect', onConnect)
      socket.once('error', onError)
    })

    const pending = new Map<string, PendingRequest>()
    const eventHandlers = new Map<ServerEventType, Set<(payload: ServerEvent['payload']) => void>>()
    const decoder = new MessageDecoder<ServerResponse | ServerEvent>(parseServerMessage)

    const failAllPending = (reason: string): void => {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer)
        pending.delete(id)
        entry.reject(new Error(reason))
      }
    }

    socket.on('data', (chunk) => {
      try {
        for (const message of decoder.push(chunk)) {
          if ('id' in message) {
            const entry = pending.get(message.id)
            if (entry) {
              clearTimeout(entry.timer)
              pending.delete(message.id)
              entry.resolve(message)
            }
            continue
          }
          const handlers = eventHandlers.get(message.type)
          if (!handlers) continue
          for (const handler of handlers) handler(message.payload)
        }
      } catch (error) {
        failAllPending(
          `daemon parse error: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    })
    socket.on('close', () => failAllPending('daemon connection closed'))
    socket.on('error', (error) => failAllPending(`daemon socket error: ${error.message}`))

    // Handshake.
    const id = crypto.randomUUID()
    const helloResponse = await new Promise<ServerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('hello timed out'))
      }, REQUEST_TIMEOUT_MS)
      pending.set(id, { reject, resolve, timer })
      socket.write(
        encodeMessage({
          id,
          payload: { maxVersion: IPC_PROTOCOL_VERSION, minVersion: IPC_PROTOCOL_MIN_VERSION },
          type: 'hello',
        })
      )
    })
    if (helloResponse.type !== 'helloResult') {
      const detail =
        helloResponse.type === 'error' ? helloResponse.payload.message : helloResponse.type
      throw new Error(`hello failed: ${detail}`)
    }

    return new DaemonClient(socket, helloResponse.payload, pending, eventHandlers)
  }

  hasCapability(name: string): boolean {
    return this.hello.capabilities.includes(name)
  }

  getCapabilities(): readonly string[] {
    return this.hello.capabilities
  }

  getAppVersion(): string | null {
    return this.hello.appVersion ?? null
  }

  getSelectedVersion(): number {
    return this.hello.selectedVersion
  }

  getProcessVersion(): string {
    return this.hello.processVersion
  }

  getManagerCapabilities(): readonly string[] {
    return this.hello.managerCapabilities ?? []
  }

  getManagerSelectedVersion(): number | null {
    return this.hello.managerSelectedVersion ?? null
  }

  private async send(request: ClientRequest): Promise<ServerResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id)
        reject(new Error(`request timed out: ${request.type}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(request.id, { reject, resolve, timer })
      this.socket.write(encodeMessage(request), (error) => {
        if (error) {
          clearTimeout(timer)
          this.pending.delete(request.id)
          reject(error)
        }
      })
    })
  }

  async request<T extends ClientRequest['type']>(
    type: T,
    payload: Extract<ClientRequest, { type: T }>['payload']
  ): Promise<ServerResponse> {
    return this.send({ id: crypto.randomUUID(), payload, type } as ClientRequest)
  }

  async expectOk(type: ClientRequest['type'], payload: unknown): Promise<void> {
    const response = await this.send({
      id: crypto.randomUUID(),
      payload,
      type,
    } as ClientRequest)
    if (response.type === 'ok') return
    throw new Error(
      response.type === 'error' ? response.payload.message : `unexpected response: ${response.type}`
    )
  }

  async attach(request: Omit<AttachRequest, 'protocolVersion'>): Promise<AttachResult> {
    const response = await this.send({
      id: crypto.randomUUID(),
      payload: { ...request, protocolVersion: this.hello.selectedVersion },
      type: 'attach',
    })
    if (response.type !== 'attachResult') {
      throw new Error(
        response.type === 'error' ? response.payload.message : `attach failed: ${response.type}`
      )
    }
    return response.payload
  }

  async listTabs(sessionId: string): Promise<ListTabsResult> {
    const response = await this.send({
      id: crypto.randomUUID(),
      payload: { sessionId },
      type: 'listTabs',
    })
    if (response.type !== 'listTabsResult') {
      throw new Error(
        response.type === 'error' ? response.payload.message : `listTabs failed: ${response.type}`
      )
    }
    return response.payload
  }

  on<T extends ServerEventType>(eventType: T, handler: EventHandler<T>): () => void {
    let set = this.eventHandlers.get(eventType)
    if (!set) {
      set = new Set()
      this.eventHandlers.set(eventType, set)
    }
    const cast = handler as (payload: ServerEvent['payload']) => void
    set.add(cast)
    return () => {
      set?.delete(cast)
    }
  }

  close(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      this.pending.delete(id)
      entry.reject(new Error('client closed'))
    }
    this.socket.end()
    this.socket.destroy()
  }
}
