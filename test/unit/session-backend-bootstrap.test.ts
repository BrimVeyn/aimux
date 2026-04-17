import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { dirname } from 'node:path'

import { getIpcDaemonSocketPath } from '../../src/daemon/runtime-paths'
import {
  type ClientRequest,
  encodeMessage,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  type ServerResponse,
} from '../../src/ipc/protocol'
import { probeDaemonProtocolCompatibility } from '../../src/session-backend/bootstrap'

describe('session backend bootstrap handshake', () => {
  const originalRuntimeDir = process.env.XDG_RUNTIME_DIR
  let tempRuntimeDir: string | null = null

  afterEach(() => {
    if (originalRuntimeDir === undefined) {
      delete process.env.XDG_RUNTIME_DIR
    } else {
      process.env.XDG_RUNTIME_DIR = originalRuntimeDir
    }

    if (tempRuntimeDir) {
      rmSync(tempRuntimeDir, { force: true, recursive: true })
      tempRuntimeDir = null
    }
  })

  test('accepts a compatible daemon hello handshake', async () => {
    tempRuntimeDir = mkdtempSync('/tmp/aimux-bootstrap-compatible-')
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
    })

    await new Promise<void>((resolve, reject) => {
      mkdirSync(dirname(getIpcDaemonSocketPath()), { recursive: true })
      server.once('error', reject)
      server.listen(getIpcDaemonSocketPath(), () => resolve())
    })

    try {
      await expect(probeDaemonProtocolCompatibility(getIpcDaemonSocketPath())).resolves.toEqual({
        compatible: true,
        processVersion: 'test-daemon',
        selectedVersion: IPC_PROTOCOL_VERSION,
      })
    } finally {
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

  test('rejects an incompatible daemon hello handshake', async () => {
    tempRuntimeDir = mkdtempSync('/tmp/aimux-bootstrap-incompatible-')
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
                maxVersion: IPC_PROTOCOL_VERSION,
                minVersion: IPC_PROTOCOL_VERSION,
                processVersion: 'old-daemon',
                selectedVersion: IPC_PROTOCOL_VERSION,
              },
              type: 'helloResult',
            }
          } else if (message.type === 'attach') {
            response = {
              id: message.id,
              payload: { activeTabId: null, protocolVersion: 1, tabs: [] },
              type: 'attachResult',
            }
          } else {
            response = { id: message.id, payload: {}, type: 'ok' }
          }
          socket.write(encodeMessage(response))
        }
      })
    })

    await new Promise<void>((resolve, reject) => {
      mkdirSync(dirname(getIpcDaemonSocketPath()), { recursive: true })
      server.once('error', reject)
      server.listen(getIpcDaemonSocketPath(), () => resolve())
    })

    try {
      await expect(probeDaemonProtocolCompatibility(getIpcDaemonSocketPath())).resolves.toEqual({
        compatible: false,
        error: 'attach returned protocol v1',
        processVersion: 'old-daemon',
        selectedVersion: 1,
      })
    } finally {
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
