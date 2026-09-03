import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DaemonTabEntry } from '../../src/daemon/daemon'
import type { PluginRpcTransport } from '../../src/plugins/types'

import {
  clearDaemonEventListeners,
  emitDaemonEvent,
  onDaemonEvent,
} from '../../src/daemon/daemon-events'
import { createDaemonContextExtender } from '../../src/daemon/plugin-services'
import { type HookServer, startHookServer } from '../../src/integrations/hook-server'
import {
  clearPluginCliCommands,
  getPluginCliCommand,
  readPluginCliSidecar,
} from '../../src/plugins/cli-commands'
import { PluginRuntime } from '../../src/plugins/loader'
import { readPluginLog } from '../../src/plugins/log'
import { upsertPluginRegistryEntry } from '../../src/plugins/registry-file'
import { clearAssistants, getAssistantDefinition } from '../../src/pty/assistant-registry'
import { getAllAssistantOptions } from '../../src/pty/command-registry'

/**
 * The daemon chain, from a plugin file on disk to something the daemon can
 * act on: an assistant it can spawn, a hook route it can receive on, a CLI
 * verb it can run — and an unload that leaves none of them behind.
 */

const FIXTURES = join(new URL('..', import.meta.url).pathname, 'fixtures', 'plugins')

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
const originalWatch = process.env.AIMUX_PLUGIN_WATCH
const originalXdg = process.env.XDG_RUNTIME_DIR

let tempHome = ''
let runtime: PluginRuntime | null = null
let hookServer: HookServer | null = null
let tabs = new Map<string, DaemonTabEntry>()
let spawned: unknown[] = []
let writes: { tabId: string; data: string }[] = []
let renames: { tabId: string; title: string }[] = []

const TRANSPORT: PluginRpcTransport = { broadcast: () => {}, call: async () => null }

async function start(): Promise<PluginRuntime> {
  const root = join(tempHome, 'daemon-kit')
  cpSync(join(FIXTURES, 'daemon-kit'), root, { recursive: true })
  upsertPluginRegistryEntry({
    enabled: true,
    id: 'aimux-test.daemonkit',
    path: root,
    source: 'link',
  })

  hookServer = startHookServer()
  const instance = new PluginRuntime({
    extendContext: createDaemonContextExtender({
      activeTabId: () => 'tab-1',
      closeTab: async () => {},
      focus: async () => {},
      hookServer: () => hookServer,
      renameTab: (tabId, title) => {
        renames.push({ tabId, title })
      },
      spawnTab: async (input) => {
        spawned.push(input)
        return 'tab-new'
      },
      tabs: () => tabs,
      write: async (tabId, data) => {
        writes.push({ data, tabId })
      },
    }),
    host: 'daemon',
    transport: TRANSPORT,
    userPlugins: [],
  })
  runtime = instance
  await instance.start()
  return instance
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-daemon-services-'))
  mkdirSync(tempHome, { recursive: true })
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'daemon-services-test'
  process.env.AIMUX_PLUGIN_WATCH = '0'
  delete process.env.XDG_RUNTIME_DIR
  tabs = new Map()
  spawned = []
  writes = []
  renames = []
})

afterEach(async () => {
  await runtime?.stop()
  runtime = null
  await hookServer?.stop()
  hookServer = null
  clearAssistants()
  clearPluginCliCommands()
  clearDaemonEventListeners()
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  if (originalWatch === undefined) delete process.env.AIMUX_PLUGIN_WATCH
  else process.env.AIMUX_PLUGIN_WATCH = originalWatch
  if (originalXdg === undefined) delete process.env.XDG_RUNTIME_DIR
  else process.env.XDG_RUNTIME_DIR = originalXdg
  rmSync(tempHome, { force: true, recursive: true })
})

describe('daemon plugin services', () => {
  test('every registration lands', async () => {
    const instance = await start()
    expect(instance.statuses()[0]?.state).toBe('active')

    expect(getAssistantDefinition('acme.robot')?.detectStatus).toBeDefined()
    expect(getAllAssistantOptions({}).map((option) => option.id)).toContain('acme.robot')
    // The hook route is namespaced by plugin id, so it cannot collide with
    // another plugin's — or with `claude`.
    expect(hookServer?.urlFor('aimux-test.daemonkit.events')).toContain(
      '/hook/aimux-test.daemonkit.events'
    )
    expect(getPluginCliCommand('acme', 'ping')).toBeDefined()
    expect(readPluginCliSidecar().map((spec) => spec.verb)).toEqual(['ping'])
  })

  test('the CLI command runs in this process and returns its body', async () => {
    await start()
    const command = getPluginCliCommand('acme', 'ping')
    expect(await command?.run({ flags: {}, positionals: ['robot'] })).toEqual({
      echoed: ['robot'],
    })
  })

  test('ctx.tabs reads the daemon registry', async () => {
    tabs.set('tab-1', {
      assistant: 'claude',
      command: 'claude',
      projectId: 'p1',
      title: 'Worker',
      viewport: undefined,
      viewportSeq: 1,
    })
    const instance = await start()

    // The fixture answers over RPC, which is how the daemon half is reached.
    expect(await instance.kernel.handleRpc('aimux-test.daemonkit', 'tabCount', undefined)).toBe(1)
  })

  test('a daemon event reaches the plugin through the kernel bus', async () => {
    const instance = await start()
    instance.kernel.emit('tab:turnComplete', { idleMs: 900, projectId: 'p1', tabId: 't1' })
    await Bun.sleep(10)

    const messages = readPluginLog('aimux-test.daemonkit').map((entry) => entry.message)
    expect(messages).toContain('turn complete')
  })

  test('a hook POST reaches the plugin s route', async () => {
    await start()
    const url = hookServer?.urlFor('aimux-test.daemonkit.events')
    expect(url).toBeTruthy()
    if (url == null) return

    await fetch(url, {
      body: JSON.stringify({ aimuxPaneId: 't1', hook_event_name: 'TurnEnded' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    await Bun.sleep(10)

    expect(readPluginLog('aimux-test.daemonkit').map((entry) => entry.message)).toContain('hook')
  })

  test('unloading leaves nothing behind', async () => {
    const instance = await start()
    await instance.kernel.unload('aimux-test.daemonkit')

    expect(getAssistantDefinition('acme.robot')).toBeUndefined()
    expect(getPluginCliCommand('acme', 'ping')).toBeUndefined()
    // Completion must stop offering a verb nothing can answer.
    expect(readPluginCliSidecar()).toEqual([])
    expect(hookServer?.urlFor('aimux-test.daemonkit.events')).toBeNull()
  })

  test('a reload registers exactly once', async () => {
    const instance = await start()
    await instance.kernel.reload('aimux-test.daemonkit')

    expect(readPluginCliSidecar()).toHaveLength(1)
    expect(getAssistantDefinition('acme.robot')).toBeDefined()
    expect(instance.statuses()[0]?.revision).toBe(2)
  })

  test('ctx.tabs.spawn and .send reach the daemon backings', async () => {
    const instance = await start()

    expect(await instance.kernel.handleRpc('aimux-test.daemonkit', 'spawnWorker', undefined)).toBe(
      'tab-new'
    )
    expect(spawned).toEqual([
      { assistant: 'acme.robot', command: 'acme-robot', projectId: 'p1', title: 'Robot' },
    ])

    await instance.kernel.handleRpc('aimux-test.daemonkit', 'nudge', 'tab-1')
    // Bytes, not a line: the newline is the caller's to add, and it did.
    expect(writes).toEqual([{ data: 'hello\r', tabId: 'tab-1' }])
  })

  test('an event emitted on the daemon bus reaches a subscriber', () => {
    // Guards the bridge: an event added to `DaemonEvents` and forgotten in the
    // host's forwarding list would be silently invisible to every plugin.
    const seen: unknown[] = []
    const dispose = onDaemonEvent('tab:turnComplete', (payload) => seen.push(payload))
    emitDaemonEvent('tab:turnComplete', { idleMs: 1, projectId: 'p', tabId: 't' })
    dispose()
    expect(seen).toHaveLength(1)
  })
})

describe('ctx.tabs.rename', () => {
  test('a title change goes where aimux own does', async () => {
    const instance = await start()

    await instance.kernel.handleRpc('aimux-test.daemonkit', 'retitle', 'tab-1')

    // Not a suggestion: the backing is the same `applyTabMetadata` auto-rename
    // uses, so the title reaches the manager, the session and every attached
    // UI — a plugin cannot produce a title aimux itself could not.
    expect(renames).toEqual([{ tabId: 'tab-1', title: 'reviewing the diff' }])
  })
})
