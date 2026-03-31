import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getDaemonSocketPath } from '../../src/daemon/runtime-paths'
import {
  encodeMessage,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  type ClientRequest,
  type ServerResponse,
} from '../../src/ipc/protocol'
import { RemoteSessionBackend } from '../../src/session-backend/remote-session-backend'

function waitFor<T>(getValue: () => T | undefined, timeoutMs = 1_000): Promise<T> {
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

    if (tempRuntimeDir) {
      rmSync(tempRuntimeDir, { recursive: true, force: true })
      tempRuntimeDir = null
    }
  })

  test('reconnects cleanly and preserves multiline payload framing', async () => {
    tempRuntimeDir = mkdtempSync(join(tmpdir(), 'aimux-remote-backend-'))
    process.env.XDG_RUNTIME_DIR = tempRuntimeDir

    const requests: ClientRequest[] = []
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      const decoder = new MessageDecoder<ClientRequest>()

      socket.on('data', (chunk) => {
        for (const message of decoder.push(chunk)) {
          requests.push(message)

          const response: ServerResponse =
            message.type === 'attach'
              ? {
                  id: message.id,
                  type: 'attachResult',
                  payload: {
                    protocolVersion: IPC_PROTOCOL_VERSION,
                    tabs: [],
                    activeTabId: null,
                  },
                }
              : { id: message.id, type: 'ok', payload: {} }
          socket.write(encodeMessage(response))
        }
      })

      socket.on('close', () => {
        sockets.delete(socket)
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(getDaemonSocketPath(), () => resolve())
    })

    const backend = new RemoteSessionBackend()

    try {
      await backend.attach({ sessionId: 'session-a', cols: 80, rows: 24 })
      backend.write('tab-1', 'hello\nworld')

      await waitFor(() => requests.find((message) => message.type === 'write'))

      await backend.destroy(true)
      await backend.attach({ sessionId: 'session-b', cols: 100, rows: 30 })

      const attachRequests = requests.filter((message) => message.type === 'attach')
      const writeRequest = requests.find((message) => message.type === 'write')

      expect(attachRequests).toHaveLength(2)
      expect(attachRequests[0]?.payload.protocolVersion).toBe(IPC_PROTOCOL_VERSION)
      expect(attachRequests[0]?.payload.sessionId).toBe('session-a')
      expect(attachRequests[1]?.payload.sessionId).toBe('session-b')
      expect(writeRequest?.payload.data).toBe('hello\nworld')
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

  test('surfaces server command errors for tab-scoped mutations', async () => {
    tempRuntimeDir = mkdtempSync(join(tmpdir(), 'aimux-remote-backend-error-'))
    process.env.XDG_RUNTIME_DIR = tempRuntimeDir

    const requests: ClientRequest[] = []
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      const decoder = new MessageDecoder<ClientRequest>()

      socket.on('data', (chunk) => {
        for (const message of decoder.push(chunk)) {
          requests.push(message)

          const response: ServerResponse =
            message.type === 'attach'
              ? {
                  id: message.id,
                  type: 'attachResult',
                  payload: {
                    protocolVersion: IPC_PROTOCOL_VERSION,
                    tabs: [],
                    activeTabId: null,
                  },
                }
              : message.type === 'write'
                ? { id: message.id, type: 'error', payload: { message: 'write rejected' } }
                : { id: message.id, type: 'ok', payload: {} }
          socket.write(encodeMessage(response))
        }
      })

      socket.on('close', () => {
        sockets.delete(socket)
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(getDaemonSocketPath(), () => resolve())
    })

    const backend = new RemoteSessionBackend()
    let backendError: { tabId: string; message: string } | undefined

    backend.on('error', (tabId, message) => {
      backendError = { tabId, message }
    })

    try {
      await backend.attach({ sessionId: 'session-a', cols: 80, rows: 24 })
      backend.write('tab-1', 'hello')

      await waitFor(() => backendError)

      expect(backendError).toEqual({ tabId: 'tab-1', message: 'write rejected' })
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
    tempRuntimeDir = mkdtempSync(join(tmpdir(), 'aimux-remote-backend-protocol-'))
    process.env.XDG_RUNTIME_DIR = tempRuntimeDir

    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      const decoder = new MessageDecoder<ClientRequest>()

      socket.on('data', (chunk) => {
        for (const message of decoder.push(chunk)) {
          const response: ServerResponse =
            message.type === 'attach'
              ? {
                  id: message.id,
                  type: 'attachResult',
                  payload: { protocolVersion: 999, tabs: [], activeTabId: null },
                }
              : { id: message.id, type: 'ok', payload: {} }
          socket.write(encodeMessage(response))
        }
      })

      socket.on('close', () => {
        sockets.delete(socket)
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(getDaemonSocketPath(), () => resolve())
    })

    const backend = new RemoteSessionBackend()

    try {
      await expect(backend.attach({ sessionId: 'session-a', cols: 80, rows: 24 })).rejects.toThrow(
        'Unsupported protocol version: 999'
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
