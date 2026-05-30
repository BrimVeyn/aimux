import type { ServerWebSocket } from 'bun'

import type { SessionBackend } from '../session-backend/types'
import type { GuiRuntime } from './runtime'

import { logDebug } from '../debug/input-log'
import { type ActiveWsState, dispatchClientMessage, REQUEST_BYTES_CAPACITY } from './message-router'
import { type GuiServerMessage, parseClientMessage, PROTOCOL_VERSION } from './protocol'

export interface GuiTransport {
  readonly port: number
  dispose: () => void
}

export interface ServeGuiRuntimeDeps {
  runtime: GuiRuntime
  backend: SessionBackend
  port: number
  hostname?: string
}

export function serveGuiRuntime(deps: ServeGuiRuntimeDeps): GuiTransport {
  const { backend, hostname = '127.0.0.1', port, runtime } = deps

  let activeWs: ServerWebSocket<unknown> | null = null
  let activeWsState: ActiveWsState | null = null
  const send = (message: GuiServerMessage): void => {
    activeWs?.send(JSON.stringify(message))
  }

  // Wire runtime events to the active WS. The runtime emits independently
  // of whether a client is connected — the `activeWs?.send` no-ops when
  // there's no peer.
  const unsubscribeProjection = runtime.events.onProjection((projection) => {
    send({ projection, t: 'state' })
  })
  const unsubscribeBytes = runtime.events.onBytes(({ data, tabId }) => {
    send({ data, t: 'bytes', tabId })
  })

  const server = Bun.serve({
    fetch(req, srv) {
      if (new URL(req.url).pathname === '/ws') {
        if (srv.upgrade(req)) {
          return
        }
        return new Response('upgrade failed', { status: 426 })
      }
      return new Response('aimux gui host', { status: 200 })
    },
    hostname,
    port,
    websocket: {
      close(ws) {
        if (activeWs === ws) {
          activeWs = null
          activeWsState = null
          // TODO(P0.8): pause backend broadcast when no client is connected.
          // `setBroadcastEnabled` lives on pty-manager.ts but is not exposed
          // through the SessionBackend interface; wiring it requires either
          // an interface extension or a remote-backend IPC verb. Leaving
          // commented to make the gap visible.
          // backend.setBroadcastEnabled?.(false)
        }
      },
      message(ws, raw) {
        const message = parseClientMessage(typeof raw === 'string' ? raw : raw.toString())
        if (message === null) {
          return
        }
        dispatchClientMessage(message, {
          activeWsState,
          backend,
          runtime,
          send,
        })
      },
      open(ws) {
        // Single-client host: a Tauri reload / HMR / second window arrives as
        // a new socket without the old one closing first. Close the previous
        // peer explicitly so we don't leak silently-dead clients.
        if (activeWs !== null && activeWs !== ws) {
          logDebug('gui.host.displacingPreviousClient', {})
          activeWs.close(1000, 'displaced by new client')
        }
        activeWs = ws
        activeWsState = {
          requestBytesLastRefillMs: performance.now(),
          requestBytesTokens: REQUEST_BYTES_CAPACITY,
          ws,
        }
        // TODO(P0.8): resume backend broadcast on first client connect; see
        // matching note in close(). Symmetric with the pause TODO above.
        // backend.setBroadcastEnabled?.(true)
        // Handshake first: the renderer refuses to interpret any subsequent
        // frame until it has seen `hello` and verified the protocol version.
        send({ capabilities: [], t: 'hello', version: PROTOCOL_VERSION })
        // Push the initial state projection. Each xterm.js pane pulls its own
        // scrollback via requestBytes once it mounts, so there's nothing to
        // replay here.
        send({ projection: runtime.buildProjection(), t: 'state' })
      },
    },
  })

  const resolvedPort = server.port ?? port

  return {
    dispose: () => {
      unsubscribeProjection()
      unsubscribeBytes()
      void server.stop()
    },
    port: resolvedPort,
  }
}
