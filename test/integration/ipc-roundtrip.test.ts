import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  type ClientRequest,
  encodeMessage,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  parseClientRequest,
  parseServerMessage,
  type ServerEvent,
  type ServerResponse,
} from '../../src/ipc/protocol'

function createTempSocketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aimux-ipc-'))
  return join(dir, 'test.sock')
}

function startMockDaemon() {
  const decoder = new MessageDecoder<ClientRequest>(parseClientRequest)
  const received: ClientRequest[] = []

  const server = createServer((socket) => {
    socket.on('data', (chunk) => {
      for (const message of decoder.push(chunk)) {
        received.push(message)

        if (message.type === 'attach') {
          const response: ServerResponse = {
            id: message.id,
            type: 'attachResult',
            payload: {
              protocolVersion: IPC_PROTOCOL_VERSION,
              tabs: [],
              activeTabId: null,
            },
          }
          socket.write(encodeMessage(response))
        } else if (message.type === 'createTab') {
          socket.write(encodeMessage({ id: message.id, type: 'ok', payload: {} }))

          const renderEvent: ServerEvent = {
            type: 'tabRender',
            payload: {
              tabId: message.payload.tabId,
              viewport: {
                lines: [{ spans: [{ text: 'hello from daemon' }] }],
                viewportY: 0,
                baseY: 0,
                cursorVisible: true,
              },
              terminalModes: {
                mouseTrackingMode: 'none',
                sendFocusMode: false,
                alternateScrollMode: false,
                isAlternateBuffer: false,
                bracketedPasteMode: false,
              },
            },
          }
          socket.write(encodeMessage(renderEvent))
        } else if (message.type === 'write') {
          socket.write(encodeMessage({ id: message.id, type: 'ok', payload: {} }))
        } else {
          socket.write(encodeMessage({ id: message.id, type: 'ok', payload: {} }))
        }
      }
    })
  })

  return { server, received }
}

async function connectClient(socketPath: string): Promise<{
  socket: Socket
  decoder: MessageDecoder<ServerResponse | ServerEvent>
  send: (request: ClientRequest) => void
  waitForMessages: (count: number, timeoutMs?: number) => Promise<(ServerResponse | ServerEvent)[]>
}> {
  const { connect } = await import('node:net')
  const socket = connect(socketPath)
  const decoder = new MessageDecoder<ServerResponse | ServerEvent>(parseServerMessage)
  const all: (ServerResponse | ServerEvent)[] = []

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })

  socket.on('data', (chunk) => {
    for (const message of decoder.push(chunk)) {
      all.push(message)
    }
  })

  return {
    socket,
    decoder,
    send: (request) => socket.write(encodeMessage(request)),
    waitForMessages: async (count, timeoutMs = 3_000) => {
      const deadline = Date.now() + timeoutMs
      while (all.length < count && Date.now() < deadline) {
        await Bun.sleep(10)
      }
      return [...all]
    },
  }
}

describe('IPC round-trip integration', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.()
    }
  })

  test('attach -> createTab -> receive render event', async () => {
    const socketPath = createTempSocketPath()
    const { server, received } = startMockDaemon()

    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
    cleanups.push(() => {
      server.close()
      try {
        rmSync(socketPath)
      } catch {}
    })

    const client = await connectClient(socketPath)
    cleanups.push(() => client.socket.destroy())

    // 1. Attach
    client.send({
      id: 'req-1',
      type: 'attach',
      payload: {
        protocolVersion: IPC_PROTOCOL_VERSION,
        sessionId: 'session-test',
        cols: 80,
        rows: 24,
      },
    })

    let messages = await client.waitForMessages(1)
    expect(messages[0]).toMatchObject({
      id: 'req-1',
      type: 'attachResult',
      payload: { protocolVersion: IPC_PROTOCOL_VERSION, tabs: [], activeTabId: null },
    })

    // 2. Create tab
    client.send({
      id: 'req-2',
      type: 'createTab',
      payload: {
        tabId: 'tab-1',
        assistant: 'claude',
        title: 'Claude',
        command: 'echo',
        cols: 80,
        rows: 24,
      },
    })

    // Should get ok + render event
    messages = await client.waitForMessages(3)
    const okResponse = messages.find((m) => 'id' in m && m.id === 'req-2')
    expect(okResponse).toMatchObject({ type: 'ok' })

    const renderEvent = messages.find((m) => m.type === 'tabRender')
    expect(renderEvent).toMatchObject({
      type: 'tabRender',
      payload: {
        tabId: 'tab-1',
        viewport: { lines: [{ spans: [{ text: 'hello from daemon' }] }] },
      },
    })

    // 3. Verify daemon received all messages in order
    expect(received.map((m) => m.type)).toEqual(['attach', 'createTab'])
  }, 10_000)

  test('write command is acknowledged', async () => {
    const socketPath = createTempSocketPath()
    const { server } = startMockDaemon()

    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
    cleanups.push(() => {
      server.close()
      try {
        rmSync(socketPath)
      } catch {}
    })

    const client = await connectClient(socketPath)
    cleanups.push(() => client.socket.destroy())

    // Attach first
    client.send({
      id: 'req-attach',
      type: 'attach',
      payload: {
        protocolVersion: IPC_PROTOCOL_VERSION,
        sessionId: 'session-write',
        cols: 80,
        rows: 24,
      },
    })
    await client.waitForMessages(1)

    // Write
    client.send({
      id: 'req-write',
      type: 'write',
      payload: { tabId: 'tab-1', data: 'hello world\n' },
    })

    const messages = await client.waitForMessages(2)
    const writeOk = messages.find((m) => 'id' in m && m.id === 'req-write')
    expect(writeOk).toMatchObject({ type: 'ok' })
  }, 10_000)

  test('ping is acknowledged', async () => {
    const socketPath = createTempSocketPath()
    const { server } = startMockDaemon()

    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
    cleanups.push(() => {
      server.close()
      try {
        rmSync(socketPath)
      } catch {}
    })

    const client = await connectClient(socketPath)
    cleanups.push(() => client.socket.destroy())

    client.send({ id: 'req-ping', type: 'ping', payload: {} })

    const messages = await client.waitForMessages(1)
    expect(messages[0]).toMatchObject({ id: 'req-ping', type: 'ok' })
  }, 10_000)

  test('custom assistant id is accepted in createTab', async () => {
    const socketPath = createTempSocketPath()
    const { server, received } = startMockDaemon()

    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
    cleanups.push(() => {
      server.close()
      try {
        rmSync(socketPath)
      } catch {}
    })

    const client = await connectClient(socketPath)
    cleanups.push(() => client.socket.destroy())

    client.send({
      id: 'req-1',
      type: 'attach',
      payload: {
        protocolVersion: IPC_PROTOCOL_VERSION,
        sessionId: 'session-custom',
        cols: 80,
        rows: 24,
      },
    })
    await client.waitForMessages(1)

    client.send({
      id: 'req-2',
      type: 'createTab',
      payload: {
        tabId: 'tab-custom',
        assistant: 'my-custom-ai',
        title: 'Custom AI',
        command: 'my-ai-cli',
        cols: 80,
        rows: 24,
      },
    })

    const messages = await client.waitForMessages(3)
    const ok = messages.find((m) => 'id' in m && m.id === 'req-2')
    expect(ok).toMatchObject({ type: 'ok' })

    const createRequest = received.find((m) => m.type === 'createTab')
    expect(createRequest?.payload).toMatchObject({ assistant: 'my-custom-ai' })
  }, 10_000)
})
