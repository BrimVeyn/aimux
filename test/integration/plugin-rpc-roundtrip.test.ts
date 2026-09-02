import { afterEach, describe, expect, test } from 'bun:test'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { connect, createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startDaemonPluginHost } from '../../src/daemon/plugin-host'
import {
  type ClientRequest,
  encodeMessage,
  IPC_CAPABILITY_PLUGIN_RPC,
  IPC_PROTOCOL_CAPABILITIES,
  IPC_PROTOCOL_VERSION,
  IpcProtocolError,
  MessageDecoder,
  parseClientRequest,
  parseServerMessage,
  type ServerEvent,
  type ServerResponse,
} from '../../src/ipc/protocol'
import { upsertPluginRegistryEntry } from '../../src/plugins/registry-file'
import { PLUGIN_RPC_REPLY_VERB } from '../../src/plugins/rpc-envelope'

const FIXTURES = join(new URL('..', import.meta.url).pathname, 'fixtures', 'plugins')

/**
 * The v19 plugin channel on the wire, plus the daemon-side switchboard that
 * sits behind it. The point being pinned down: the protocol validates the
 * *envelope* — `pluginId`, `verb` — and never the payload, which is what lets
 * the plugin API evolve without a protocol bump.
 */

describe('plugin RPC — protocol envelope', () => {
  test('advertises the pluginRpc capability', () => {
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_PLUGIN_RPC)
    expect(IPC_PROTOCOL_VERSION).toBeGreaterThanOrEqual(19)
  })

  test('accepts any payload shape and validates only the envelope', () => {
    for (const payload of [undefined, null, 42, 'text', { deep: { nested: [1, 2] } }]) {
      const parsed = parseClientRequest({
        id: 'r1',
        payload: { payload, pluginId: 'acme.x', verb: 'greet' },
        type: 'pluginRequest',
      })
      expect(parsed.type).toBe('pluginRequest')
    }
  })

  test('rejects a request with no plugin id or verb', () => {
    expect(() =>
      parseClientRequest({ id: 'r', payload: { verb: 'greet' }, type: 'pluginRequest' })
    ).toThrow(IpcProtocolError)
    expect(() =>
      parseClientRequest({
        id: 'r',
        payload: { pluginId: 'acme.x', verb: '' },
        type: 'pluginRequest',
      })
    ).toThrow(IpcProtocolError)
  })

  test('round-trips pluginResult and pluginEvent through the server parser', () => {
    const result = parseServerMessage({
      id: 'r1',
      payload: { result: { ok: true } },
      type: 'pluginResult',
    })
    expect(result).toMatchObject({ payload: { result: { ok: true } }, type: 'pluginResult' })

    const event = parseServerMessage({
      payload: { payload: [1, 2], pluginId: 'acme.x', verb: 'tick' },
      type: 'pluginEvent',
    })
    expect(event).toMatchObject({ type: 'pluginEvent' })
  })
})

describe('plugin RPC — over a socket', () => {
  const cleanups: (() => void)[] = []

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.()
  })

  test('a client request reaches the daemon host and its result comes back', async () => {
    const socketPath = join(mkdtempSync(join(tmpdir(), 'aimux-plugin-rpc-')), 'test.sock')

    // Minimal daemon: hello, then hand every `pluginRequest` to the real host.
    const host = await startDaemonPluginHost({
      broadcast: () => {},
      hasUiClient: () => false,
      userPlugins: [],
    })
    cleanups.push(() => void host.stop())

    // A handler registered directly on the kernel stands in for a loaded
    // plugin — this test is about the wire, not about loading.
    cleanups.push(host.runtime.kernel.services.provide('noop', true))
    const kernelHandlers = host.runtime.kernel as unknown as {
      rpcHandlers: Map<string, Map<string, (payload: unknown) => unknown>>
    }
    kernelHandlers.rpcHandlers.set(
      'acme.x',
      new Map([['greet', (payload: unknown) => `hi ${String((payload as { name: string }).name)}`]])
    )

    const server = createServer((socket) => {
      const decoder = new MessageDecoder<ClientRequest>(parseClientRequest)
      socket.on('data', (chunk: Buffer) => {
        void (async () => {
          for (const message of decoder.push(chunk)) {
            if (message.type === 'hello') {
              socket.write(
                encodeMessage({
                  id: message.id,
                  payload: {
                    capabilities: [...IPC_PROTOCOL_CAPABILITIES],
                    maxVersion: IPC_PROTOCOL_VERSION,
                    minVersion: IPC_PROTOCOL_VERSION,
                    processVersion: 'test',
                    selectedVersion: IPC_PROTOCOL_VERSION,
                  },
                  type: 'helloResult',
                })
              )
              continue
            }
            if (message.type !== 'pluginRequest') continue
            try {
              const result = await host.handleRequest(
                message.payload.pluginId,
                message.payload.verb,
                message.payload.payload
              )
              socket.write(
                encodeMessage({ id: message.id, payload: { result }, type: 'pluginResult' })
              )
            } catch (error) {
              socket.write(
                encodeMessage({
                  id: message.id,
                  payload: { message: error instanceof Error ? error.message : String(error) },
                  type: 'error',
                })
              )
            }
          }
        })()
      })
    })
    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
    cleanups.push(() => {
      server.close()
      try {
        rmSync(socketPath)
      } catch {
        /* already gone */
      }
    })

    const socket: Socket = connect(socketPath)
    cleanups.push(() => socket.destroy())
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })

    const decoder = new MessageDecoder<ServerResponse | ServerEvent>(parseServerMessage)
    const received: (ServerResponse | ServerEvent)[] = []
    socket.on('data', (chunk) => {
      for (const message of decoder.push(chunk)) received.push(message)
    })
    const waitFor = async (count: number): Promise<void> => {
      const deadline = Date.now() + 3000
      while (received.length < count && Date.now() < deadline) await Bun.sleep(5)
    }

    socket.write(
      encodeMessage({
        id: 'hello',
        payload: { maxVersion: IPC_PROTOCOL_VERSION, minVersion: IPC_PROTOCOL_VERSION },
        type: 'hello',
      })
    )
    await waitFor(1)
    expect((received[0] as ServerResponse).payload).toMatchObject({
      capabilities: expect.arrayContaining([IPC_CAPABILITY_PLUGIN_RPC]),
    })

    socket.write(
      encodeMessage({
        id: 'call-1',
        payload: { payload: { name: 'world' }, pluginId: 'acme.x', verb: 'greet' },
        type: 'pluginRequest',
      })
    )
    await waitFor(2)
    expect(received[1]).toMatchObject({
      id: 'call-1',
      payload: { result: 'hi world' },
      type: 'pluginResult',
    })

    // An unhandled verb is an error reply, not a dropped connection.
    socket.write(
      encodeMessage({
        id: 'call-2',
        payload: { pluginId: 'acme.x', verb: 'unknown' },
        type: 'pluginRequest',
      })
    )
    await waitFor(3)
    expect(received[2]).toMatchObject({ id: 'call-2', type: 'error' })
  })

  test('a daemon → UI call travels as an event and is answered on the reply verb', async () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'aimux-plugin-call-'))
    const previousHome = process.env.HOME
    const previousProfile = process.env.AIMUX_PROFILE
    const previousWatch = process.env.AIMUX_PLUGIN_WATCH
    process.env.HOME = tempHome
    process.env.AIMUX_PROFILE = 'plugin-rpc-test'
    process.env.AIMUX_PLUGIN_WATCH = '0'
    cleanups.push(() => {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      if (previousProfile === undefined) delete process.env.AIMUX_PROFILE
      else process.env.AIMUX_PROFILE = previousProfile
      if (previousWatch === undefined) delete process.env.AIMUX_PLUGIN_WATCH
      else process.env.AIMUX_PLUGIN_WATCH = previousWatch
      rmSync(tempHome, { force: true, recursive: true })
    })

    const root = join(tempHome, 'caller')
    cpSync(join(FIXTURES, 'caller'), root, { recursive: true })
    upsertPluginRegistryEntry({
      enabled: true,
      id: 'aimux-test.caller',
      path: root,
      source: 'link',
    })

    const events: { pluginId: string; verb: string; payload?: unknown }[] = []
    let uiAttached = false
    const host = await startDaemonPluginHost({
      broadcast: (event) => events.push(event),
      hasUiClient: () => uiAttached,
      userPlugins: [],
    })
    cleanups.push(() => void host.stop())
    expect(host.statuses()[0]?.state).toBe('active')

    // No UI half attached: the call must reject with a diagnosis rather than
    // wait out its timeout.
    expect(host.handleRequest('aimux-test.caller', 'ask', { q: 1 })).rejects.toThrow(
      /no UI half attached/
    )

    uiAttached = true
    const pending = host.handleRequest('aimux-test.caller', 'ask', { q: 42 })
    await Bun.sleep(20)

    // The call left as an event carrying a correlation id.
    const outbound = events.find((event) => event.verb === 'question')
    expect(outbound?.pluginId).toBe('aimux-test.caller')
    const envelope = outbound?.payload as { __call: string; payload: unknown }
    expect(typeof envelope.__call).toBe('string')
    expect(envelope.payload).toEqual({ q: 42 })

    // The UI answers on the reserved reply verb, which the host intercepts
    // before any plugin dispatch.
    await host.handleRequest('aimux', PLUGIN_RPC_REPLY_VERB, {
      __call: envelope.__call,
      ok: true,
      result: 'the answer',
    })
    expect(await pending).toBe('the answer')
  })

  test('the control channel answers list without any plugin loaded', async () => {
    const host = await startDaemonPluginHost({
      broadcast: () => {},
      hasUiClient: () => false,
      userPlugins: [],
    })
    cleanups.push(() => void host.stop())

    const result = (await host.handleRequest('aimux', 'list', {})) as {
      plugins: unknown[]
      known: unknown[]
    }
    expect(result.plugins).toEqual([])
    expect(result.known).toEqual([])
    expect(host.handleRequest('aimux', 'nonsense', {})).rejects.toThrow(
      /unknown plugin control verb/
    )
  })
})
