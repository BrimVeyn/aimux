import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DaemonClient } from '../../src/cli/client/daemon-client'
import {
  type ClientRequest,
  encodeMessage,
  IPC_CAPABILITY_LIST_TABS,
  IPC_CAPABILITY_THIN_ATTACH,
  IPC_PROTOCOL_MIN_VERSION,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  parseClientRequest,
  type ServerEvent,
  type ServerResponse,
} from '../../src/ipc/protocol'

function tempSocketPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'aimux-cli-')), 'test.sock')
}

interface MockDaemon {
  received: ClientRequest[]
  emit: (event: ServerEvent) => void
  close: () => void
}

async function startMockDaemon(socketPath: string, capabilities: string[]): Promise<MockDaemon> {
  const received: ClientRequest[] = []
  let activeSocket: Socket | null = null

  const server = createServer((socket) => {
    activeSocket = socket
    const decoder = new MessageDecoder<ClientRequest>(parseClientRequest)
    socket.on('data', (chunk) => {
      for (const message of decoder.push(chunk)) {
        received.push(message)
        if (message.type === 'hello') {
          const response: ServerResponse = {
            id: message.id,
            payload: {
              capabilities: [...capabilities],
              maxVersion: IPC_PROTOCOL_VERSION,
              minVersion: IPC_PROTOCOL_MIN_VERSION,
              processVersion: 'test',
              selectedVersion: IPC_PROTOCOL_VERSION,
            },
            type: 'helloResult',
          }
          socket.write(encodeMessage(response))
        } else if (message.type === 'listTabs') {
          socket.write(
            encodeMessage({
              id: message.id,
              payload: {
                activeTabId: 'tab-1',
                tabs: [
                  {
                    activity: 'idle',
                    assistant: 'claude',
                    command: 'claude',
                    id: 'tab-1',
                    status: 'running',
                    title: 'Claude',
                  },
                ],
              },
              type: 'listTabsResult',
            })
          )
        } else if (message.type === 'attach') {
          socket.write(
            encodeMessage({
              id: message.id,
              payload: {
                activeTabId: null,
                initialSessionStatuses: [],
                protocolVersion: IPC_PROTOCOL_VERSION,
                tabs: [],
              },
              type: 'attachResult',
            })
          )
        } else if (
          message.type === 'write' ||
          message.type === 'closeTab' ||
          message.type === 'setActiveTab'
        ) {
          socket.write(encodeMessage({ id: message.id, payload: {}, type: 'ok' }))
        } else {
          socket.write(encodeMessage({ id: message.id, payload: {}, type: 'ok' }))
        }
      }
    })
  })

  return new Promise((resolve) => {
    server.listen(socketPath, () => {
      resolve({
        close: () => {
          activeSocket?.destroy()
          server.close()
          try {
            rmSync(socketPath)
          } catch {
            // best effort
          }
        },
        emit: (event) => {
          if (activeSocket) activeSocket.write(encodeMessage(event))
        },
        received,
      })
    })
  })
}

describe('CLI DaemonClient', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.()
  })

  test('connect + hello populates capabilities', async () => {
    const socketPath = tempSocketPath()
    const mock = await startMockDaemon(socketPath, [IPC_CAPABILITY_LIST_TABS])
    cleanups.push(mock.close)

    const client = await DaemonClient.connect(socketPath)
    cleanups.push(() => client.close())

    expect(client.hasCapability(IPC_CAPABILITY_LIST_TABS)).toBe(true)
    expect(client.hasCapability(IPC_CAPABILITY_THIN_ATTACH)).toBe(false)
  })

  test('listTabs returns the daemon-side summary', async () => {
    const socketPath = tempSocketPath()
    const mock = await startMockDaemon(socketPath, [IPC_CAPABILITY_LIST_TABS])
    cleanups.push(mock.close)

    const client = await DaemonClient.connect(socketPath)
    cleanups.push(() => client.close())

    const result = await client.listTabs('session-1')
    expect(result.activeTabId).toBe('tab-1')
    expect(result.tabs).toHaveLength(1)
    expect(result.tabs[0]).toMatchObject({
      assistant: 'claude',
      id: 'tab-1',
      status: 'running',
      title: 'Claude',
    })

    const listTabsRequest = mock.received.find((m) => m.type === 'listTabs')
    expect(listTabsRequest?.payload).toEqual({ sessionId: 'session-1' })
  })

  test('attach with thin:true sends the flag on the wire', async () => {
    const socketPath = tempSocketPath()
    const mock = await startMockDaemon(socketPath, [
      IPC_CAPABILITY_LIST_TABS,
      IPC_CAPABILITY_THIN_ATTACH,
    ])
    cleanups.push(mock.close)

    const client = await DaemonClient.connect(socketPath)
    cleanups.push(() => client.close())

    await client.attach({ cols: 0, rows: 0, sessionId: 'session-1', thin: true })
    const attach = mock.received.find((m) => m.type === 'attach')
    expect(attach?.payload).toMatchObject({ cols: 0, rows: 0, thin: true })
  })

  test('tabStatus events fan out to subscribers', async () => {
    const socketPath = tempSocketPath()
    const mock = await startMockDaemon(socketPath, [IPC_CAPABILITY_THIN_ATTACH])
    cleanups.push(mock.close)

    const client = await DaemonClient.connect(socketPath)
    cleanups.push(() => client.close())

    const seen: string[] = []
    client.on('tabStatus', (payload) => seen.push(payload.status))
    // Attach so the mock has an active socket to fan an event back through.
    await client.attach({ cols: 0, rows: 0, sessionId: 'session-1', thin: true })

    mock.emit({
      payload: { sessionId: 'session-1', status: 'idle', tabId: 'tab-1' },
      type: 'tabStatus',
    })

    const deadline = Date.now() + 500
    while (seen.length === 0 && Date.now() < deadline) {
      await Bun.sleep(10)
    }
    expect(seen).toEqual(['idle'])
  })
})
