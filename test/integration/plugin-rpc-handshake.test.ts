import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getIpcDaemonSocketPath } from '../../src/daemon/runtime-paths'
import {
  type ClientRequest,
  encodeMessage,
  IPC_PROTOCOL_CAPABILITIES,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  parseClientRequest,
} from '../../src/ipc/protocol'
import { RemoteSessionBackend } from '../../src/session-backend/remote-session-backend'

/**
 * A plugin's first RPC, fired before the UI has attached.
 *
 * The capability set is empty in two very different situations: a daemon too
 * old to answer, and a daemon nobody has said hello to yet. `pluginRequest`
 * read the first meaning into the second and told the plugin the daemon was
 * pre-v19 — which is what a bar widget then displayed, for as long as its
 * refresh interval, through as many daemon restarts as you cared to do.
 *
 * The window is not a narrow one. The plugin host starts with the app, and the
 * attach that carries the handshake is deliberately delayed so that holding
 * `j` through the sidebar does not attach once per keypress. A plugin whose
 * `ctx.effect` calls `ctx.rpc` — which is what every example does — lands in it
 * every single boot.
 */

const cleanups: (() => void)[] = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

/** A daemon that says hello, attaches, and echoes one plugin verb. */
async function fakeDaemon(): Promise<void> {
  const server = createServer((socket) => {
    const decoder = new MessageDecoder<ClientRequest>(parseClientRequest)
    socket.on('data', (chunk: Buffer) => {
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
        } else if (message.type === 'attach') {
          socket.write(
            encodeMessage({
              id: message.id,
              payload: {
                activeTabId: null,
                initialProjectStatuses: [],
                protocolVersion: IPC_PROTOCOL_VERSION,
                tabs: [],
              },
              type: 'attachResult',
            })
          )
        } else if (message.type === 'pluginRequest') {
          socket.write(
            encodeMessage({
              id: message.id,
              payload: { result: `${message.payload.pluginId}:${message.payload.verb}` },
              type: 'pluginResult',
            })
          )
        }
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(getIpcDaemonSocketPath(), resolve))
  cleanups.push(() => {
    server.close()
  })
}

function useTempProfile(): void {
  const tempHome = mkdtempSync(join(tmpdir(), 'aimux-rpc-handshake-'))
  const previousHome = process.env.HOME
  const previousProfile = process.env.AIMUX_PROFILE
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'rpc-handshake-test'
  cleanups.push(() => {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousProfile === undefined) delete process.env.AIMUX_PROFILE
    else process.env.AIMUX_PROFILE = previousProfile
    rmSync(tempHome, { force: true, recursive: true })
  })
}

test('an RPC issued before the attach waits for the handshake instead of failing', async () => {
  useTempProfile()
  await fakeDaemon()

  const backend = new RemoteSessionBackend()
  cleanups.push(() => void backend.destroy())

  // The plugin host starts here, with no socket open yet.
  const call = backend.pluginRequest('aimux-examples.ghstreak', 'calendar')

  // And the app attaches a moment later, as it does after the settle delay.
  await Bun.sleep(20)
  await backend.attach({ cols: 80, projectId: 'p1', rows: 24 })

  expect(await call).toBe('aimux-examples.ghstreak:calendar')
})

test('a call made once attached still answers directly', async () => {
  useTempProfile()
  await fakeDaemon()

  const backend = new RemoteSessionBackend()
  cleanups.push(() => void backend.destroy())
  await backend.attach({ cols: 80, projectId: 'p1', rows: 24 })

  expect(await backend.pluginRequest('acme.x', 'greet')).toBe('acme.x:greet')
})
