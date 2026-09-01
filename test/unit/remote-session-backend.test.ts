import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { dirname } from 'node:path'

import { getIpcDaemonSocketPath } from '../../src/daemon/runtime-paths'
import {
  type ClientRequest,
  encodeMessage,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  type ServerResponse,
} from '../../src/ipc/protocol'
import { RemoteSessionBackend } from '../../src/session-backend/remote-session-backend'

// 1.5s was enough alone and not under a loaded suite — the socket round-trips
// here are all sub-millisecond when they work, so a longer ceiling only ever
// costs time on a run that was going to fail anyway.
async function waitFor<T>(getValue: () => T | undefined, timeoutMs = 5_000): Promise<T> {
  const start = Date.now()

  return new Promise((resolve, reject) => {
    const tick = () => {
      const value = getValue()
      if (value !== undefined) {
        resolve(value)
        return
      }

      if (Date.now() - start >= timeoutMs) {
        reject(new Error('Timed out waiting for condition'))
        return
      }

      setTimeout(tick, 10)
    }

    tick()
  })
}

describe('RemoteSessionBackend', () => {
  const originalRuntimeDir = process.env.XDG_RUNTIME_DIR
  let tempRuntimeDir: string | null = null

  afterEach(() => {
    if (originalRuntimeDir === undefined) {
      delete process.env.XDG_RUNTIME_DIR
    } else {
      process.env.XDG_RUNTIME_DIR = originalRuntimeDir
    }

    if (tempRuntimeDir != null && tempRuntimeDir !== '') {
      rmSync(tempRuntimeDir, { force: true, recursive: true })
      tempRuntimeDir = null
    }
  })

  test('reconnects after IPC daemon restart and preserves multiline payload framing', async () => {
    tempRuntimeDir = mkdtempSync('/tmp/aimux-remote-backend-')
    process.env.XDG_RUNTIME_DIR = tempRuntimeDir

    const requests: ClientRequest[] = []
    let sockets = new Set<Socket>()

    const startServer = async (): Promise<Server> => {
      const server = createServer((socket) => {
        sockets.add(socket)
        const decoder = new MessageDecoder<ClientRequest>()

        socket.on('data', (chunk) => {
          for (const message of decoder.push(chunk)) {
            requests.push(message)

            let response: ServerResponse
            if (message.type === 'hello') {
              response = {
                id: message.id,
                payload: {
                  capabilities: [],
                  maxVersion: IPC_PROTOCOL_VERSION,
                  minVersion: IPC_PROTOCOL_VERSION,
                  processVersion: 'test-daemon',
                  selectedVersion: IPC_PROTOCOL_VERSION,
                },
                type: 'helloResult',
              }
            } else if (message.type === 'attach') {
              response = {
                id: message.id,
                payload: {
                  activeTabId: null,
                  initialProjectStatuses: [],
                  protocolVersion: IPC_PROTOCOL_VERSION,
                  tabs: [],
                },
                type: 'attachResult',
              }
            } else {
              response = { id: message.id, payload: {}, type: 'ok' }
            }
            socket.write(encodeMessage(response))
          }
        })

        socket.on('close', () => {
          sockets.delete(socket)
        })
      })

      await new Promise<void>((resolve, reject) => {
        mkdirSync(dirname(getIpcDaemonSocketPath()), { recursive: true })
        server.once('error', reject)
        server.listen(getIpcDaemonSocketPath(), () => resolve())
      })

      return server
    }

    const closeServer = async (server: Server) => {
      for (const socket of sockets) {
        socket.destroy()
      }
      sockets = new Set<Socket>()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }

    let server = await startServer()
    const backend = new RemoteSessionBackend()
    // A write that lands while the socket is down reports the failure through
    // `error`, and an EventEmitter throws on an `error` nobody listens for. The
    // app has a listener; without one here the reconnect window turned into an
    // unhandled throw, which is what made this test fail once in three runs.
    backend.on('error', () => {})

    try {
      await backend.attach({ cols: 80, projectId: 'project-a', rows: 24 })
      backend.write('tab-1', 'hello\nworld')

      await waitFor(() => requests.find((message) => message.type === 'write'))

      await closeServer(server)
      server = await startServer()

      await waitFor(() => {
        const attachRequests = requests.filter((message) => message.type === 'attach')
        return attachRequests.length >= 2 ? attachRequests : undefined
      }, 3_000)

      // Written on every tick rather than once. The wait above ends when the
      // *server* receives the attach, which is one round trip before the client
      // sets itself attached — and a write before that is dropped by design
      // (`skipWriteBeforeAttach`), there being nowhere to send it. Writing once
      // in that window meant waiting out the timeout for a keystroke that was
      // never going to arrive.
      await waitFor(() => {
        backend.write('tab-1', 'after\nrestart')
        return requests.find(
          (message) => message.type === 'write' && message.payload.data === 'after\nrestart'
        )
      })

      const helloRequests = requests.filter((message) => message.type === 'hello')
      const attachRequests = requests.filter((message) => message.type === 'attach')

      expect(helloRequests.length).toBeGreaterThanOrEqual(2)
      expect(attachRequests).toHaveLength(2)
      expect(attachRequests[0]?.payload.protocolVersion).toBe(IPC_PROTOCOL_VERSION)
      expect(attachRequests[0]?.payload.projectId).toBe('project-a')
      expect(attachRequests[1]?.payload.projectId).toBe('project-a')
      expect(
        requests.find(
          (message) => message.type === 'write' && message.payload.data === 'hello\nworld'
        )
      ).toBeDefined()
    } finally {
      await backend.destroy(true)
      await closeServer(server)
    }
  })

  test('surfaces server command errors for tab-scoped mutations', async () => {
    tempRuntimeDir = mkdtempSync('/tmp/aimux-remote-backend-error-')
    process.env.XDG_RUNTIME_DIR = tempRuntimeDir

    const requests: ClientRequest[] = []
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      const decoder = new MessageDecoder<ClientRequest>()

      socket.on('data', (chunk) => {
        for (const message of decoder.push(chunk)) {
          requests.push(message)

          let response: ServerResponse
          if (message.type === 'hello') {
            response = {
              id: message.id,
              payload: {
                capabilities: [],
                maxVersion: IPC_PROTOCOL_VERSION,
                minVersion: IPC_PROTOCOL_VERSION,
                processVersion: 'test-daemon',
                selectedVersion: IPC_PROTOCOL_VERSION,
              },
              type: 'helloResult',
            }
          } else if (message.type === 'attach') {
            response = {
              id: message.id,
              payload: {
                activeTabId: null,
                initialProjectStatuses: [],
                protocolVersion: IPC_PROTOCOL_VERSION,
                tabs: [],
              },
              type: 'attachResult',
            }
          } else if (message.type === 'write') {
            response = { id: message.id, payload: { message: 'write rejected' }, type: 'error' }
          } else {
            response = { id: message.id, payload: {}, type: 'ok' }
          }
          socket.write(encodeMessage(response))
        }
      })

      socket.on('close', () => {
        sockets.delete(socket)
      })
    })

    await new Promise<void>((resolve, reject) => {
      mkdirSync(dirname(getIpcDaemonSocketPath()), { recursive: true })
      server.once('error', reject)
      server.listen(getIpcDaemonSocketPath(), () => resolve())
    })

    const backend = new RemoteSessionBackend()
    let backendError: { tabId: string; message: string } | undefined

    backend.on('error', (tabId, message) => {
      backendError = { message, tabId }
    })

    try {
      await backend.attach({ cols: 80, projectId: 'project-a', rows: 24 })
      backend.write('tab-1', 'hello')

      await waitFor(() => backendError)

      expect(backendError).toEqual({ message: 'write rejected', tabId: 'tab-1' })
      expect(requests.find((message) => message.type === 'hello')).toBeDefined()
      expect(requests.find((message) => message.type === 'write')).toBeDefined()
    } finally {
      await backend.destroy(true)
      for (const socket of sockets) {
        socket.destroy()
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  })

  test('rejects mismatched attach protocol versions', async () => {
    tempRuntimeDir = mkdtempSync('/tmp/aimux-remote-backend-protocol-')
    process.env.XDG_RUNTIME_DIR = tempRuntimeDir

    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      const decoder = new MessageDecoder<ClientRequest>()

      socket.on('data', (chunk) => {
        for (const message of decoder.push(chunk)) {
          let response: ServerResponse
          if (message.type === 'hello') {
            response = {
              id: message.id,
              payload: {
                capabilities: [],
                maxVersion: IPC_PROTOCOL_VERSION,
                minVersion: IPC_PROTOCOL_VERSION,
                processVersion: 'test-daemon',
                selectedVersion: IPC_PROTOCOL_VERSION,
              },
              type: 'helloResult',
            }
          } else if (message.type === 'attach') {
            response = {
              id: message.id,
              payload: {
                activeTabId: null,
                initialProjectStatuses: [],
                protocolVersion: 999,
                tabs: [],
              },
              type: 'attachResult',
            }
          } else {
            response = { id: message.id, payload: {}, type: 'ok' }
          }
          socket.write(encodeMessage(response))
        }
      })

      socket.on('close', () => {
        sockets.delete(socket)
      })
    })

    await new Promise<void>((resolve, reject) => {
      mkdirSync(dirname(getIpcDaemonSocketPath()), { recursive: true })
      server.once('error', reject)
      server.listen(getIpcDaemonSocketPath(), () => resolve())
    })

    const backend = new RemoteSessionBackend()

    try {
      expect(backend.attach({ cols: 80, projectId: 'project-a', rows: 24 })).rejects.toThrow(
        `Protocol mismatch: client v${IPC_PROTOCOL_VERSION}, daemon v999`
      )
    } finally {
      await backend.destroy(true)
      for (const socket of sockets) {
        socket.destroy()
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  })
})
