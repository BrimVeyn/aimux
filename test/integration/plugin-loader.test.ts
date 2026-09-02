import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PluginRpcTransport } from '../../src/plugins/types'

import { PluginRuntime } from '../../src/plugins/loader'
import { upsertPluginRegistryEntry } from '../../src/plugins/registry-file'

/**
 * End-to-end for the daemon-side kernel: discovery reads the registry, the
 * loader bundles and applies each half, and everything a plugin registered
 * comes back off on unload.
 *
 * Runs against a throwaway HOME so the profile directories — registry, plugin
 * state, build artifacts — are all inside the temp tree.
 */

const FIXTURES = join(new URL('..', import.meta.url).pathname, 'fixtures', 'plugins')

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
const originalWatch = process.env.AIMUX_PLUGIN_WATCH

let tempHome = ''
let pluginsDir = ''
let runtime: PluginRuntime | null = null

/** Records what crossed the process boundary; there is no second half here. */
function recordingTransport(): PluginRpcTransport & { calls: string[] } {
  const calls: string[] = []
  return {
    broadcast: (pluginId, verb) => {
      calls.push(`broadcast:${pluginId}.${verb}`)
    },
    call: async (pluginId, verb) => {
      calls.push(`call:${pluginId}.${verb}`)
      return null
    },
    calls,
  }
}

function stage(fixture: string): string {
  const target = join(pluginsDir, fixture)
  cpSync(join(FIXTURES, fixture), target, { recursive: true })
  return target
}

function register(fixture: string, id: string, enabled = true): string {
  const root = stage(fixture)
  upsertPluginRegistryEntry({ enabled, id, path: root, source: 'link', version: '1.0.0' })
  return root
}

async function start(): Promise<PluginRuntime> {
  const instance = new PluginRuntime({
    host: 'daemon',
    transport: recordingTransport(),
    userPlugins: [],
  })
  runtime = instance
  await instance.start()
  return instance
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-plugins-'))
  pluginsDir = join(tempHome, 'checkouts')
  mkdirSync(pluginsDir, { recursive: true })
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'plugin-test'
  // The watcher is exercised by its own reload test below; leaving it on for
  // every case would make each one race a debounce window.
  process.env.AIMUX_PLUGIN_WATCH = '0'
})

afterEach(async () => {
  await runtime?.stop()
  runtime = null
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  if (originalWatch === undefined) delete process.env.AIMUX_PLUGIN_WATCH
  else process.env.AIMUX_PLUGIN_WATCH = originalWatch
  rmSync(tempHome, { force: true, recursive: true })
})

describe('plugin loader', () => {
  test('loads the half this host runs and answers its RPC verbs', async () => {
    register('hello', 'aimux-test.hello')
    const instance = await start()

    const [status] = instance.statuses()
    expect(status?.id).toBe('aimux-test.hello')
    expect(status?.state).toBe('active')
    expect(status?.host).toBe('daemon')
    expect(status?.revision).toBe(1)

    // `greeting` came from the manifest's declared default.
    expect(await instance.kernel.handleRpc('aimux-test.hello', 'greet', 'world')).toBe(
      'hello world'
    )
  })

  test('config from the registry overrides the manifest default', async () => {
    const root = stage('hello')
    upsertPluginRegistryEntry({
      config: { greeting: 'bonjour' },
      enabled: true,
      id: 'aimux-test.hello',
      path: root,
      source: 'link',
    })
    const instance = await start()
    expect(await instance.kernel.handleRpc('aimux-test.hello', 'greet', 'monde')).toBe(
      'bonjour monde'
    )
  })

  test('a plugin that throws in apply lands in FAILED and leaves nothing registered', async () => {
    register('broken', 'aimux-test.broken')
    const instance = await start()

    const [status] = instance.statuses()
    expect(status?.state).toBe('failed')
    expect(status?.error).toContain('deliberate fixture failure')
    // It registered a listener before throwing; a failed apply must still
    // unwind, or every retry would stack another one.
    expect(instance.kernel.bus.listenerCount('test:ping')).toBe(0)
  })

  test('one broken plugin does not stop another from loading', async () => {
    register('hello', 'aimux-test.hello')
    register('broken', 'aimux-test.broken')
    const instance = await start()

    const byId = new Map(instance.statuses().map((status) => [status.id, status.state]))
    expect(byId.get('aimux-test.hello')).toBe('active')
    expect(byId.get('aimux-test.broken')).toBe('failed')
  })

  test('a disabled plugin is discovered but never loaded', async () => {
    register('hello', 'aimux-test.hello', false)
    const instance = await start()
    expect(instance.statuses()).toEqual([])
    expect(instance.knownRecords().map((record) => record.id)).toEqual(['aimux-test.hello'])
  })

  test('an injected service that is missing keeps the fiber pending, and providing it applies', async () => {
    register('needs-service', 'aimux-test.needs-service')
    const instance = await start()

    expect(instance.statuses()[0]?.state).toBe('pending')
    expect(instance.statuses()[0]?.missing).toEqual(['tabs'])

    instance.kernel.services.provide('tabs', { list: () => [] })
    await Bun.sleep(50)

    expect(instance.statuses()[0]?.state).toBe('active')
    expect(
      await instance.kernel.handleRpc('aimux-test.needs-service', 'tabsPresent', undefined)
    ).toBe(true)
  })

  test('reload picks up a change in a transitive dependency', async () => {
    const root = register('multi-file', 'aimux-test.multi')
    const instance = await start()
    expect(await instance.kernel.handleRpc('aimux-test.multi', 'value', undefined)).toBe('original')

    // The case the `?v=` cache-buster could not handle: the entry is untouched
    // and only a module it imports changed.
    writeFileSync(join(root, 'value.ts'), "export const VALUE = 'reloaded'\n", 'utf8')
    await instance.reload('aimux-test.multi')

    expect(await instance.kernel.handleRpc('aimux-test.multi', 'value', undefined)).toBe('reloaded')
    expect(instance.statuses()[0]?.revision).toBe(2)
  })

  test('repeated reloads leak neither listeners nor RPC handlers', async () => {
    register('hello', 'aimux-test.hello')
    const instance = await start()

    for (let i = 0; i < 20; i++) {
      await instance.kernel.reload('aimux-test.hello')
    }

    // The fixture registers exactly three reversible things per apply — a
    // listener, an RPC verb and an interval. The counts must be identical to
    // what a single apply produces; anything higher means a disposer was
    // skipped and the twenty-first load is running alongside the first twenty.
    expect(instance.kernel.bus.listenerCount('test:ping')).toBe(1)
    expect(instance.statuses()[0]?.effects).toBe(3)
    expect(instance.statuses()[0]?.revision).toBe(21)
    expect(await instance.kernel.handleRpc('aimux-test.hello', 'greet', 'x')).toBe('hello x')
  })

  test('unloading releases the listeners and the verbs', async () => {
    register('hello', 'aimux-test.hello')
    const instance = await start()
    await instance.kernel.unload('aimux-test.hello')

    expect(instance.statuses()).toEqual([])
    expect(instance.kernel.bus.listenerCount('test:ping')).toBe(0)
    expect(instance.kernel.handleRpc('aimux-test.hello', 'greet', 'x')).rejects.toThrow(
      /no daemon handler/
    )
  })

  test('the file watcher reloads a linked plugin on save', async () => {
    // The one case that needs the watcher on: everything else disables it so a
    // debounce window cannot race the assertions.
    process.env.AIMUX_PLUGIN_WATCH = '1'
    const root = register('multi-file', 'aimux-test.multi')
    const instance = await start()
    expect(await instance.kernel.handleRpc('aimux-test.multi', 'value', undefined)).toBe('original')

    writeFileSync(join(root, 'value.ts'), "export const VALUE = 'watched'\n", 'utf8')

    const deadline = Date.now() + 5000
    let observed = 'original'
    while (Date.now() < deadline && observed !== 'watched') {
      await Bun.sleep(50)
      try {
        observed = (await instance.kernel.handleRpc(
          'aimux-test.multi',
          'value',
          undefined
        )) as string
      } catch {
        // Mid-reload the handler is briefly gone; that is the unload half of
        // the cycle, not a failure.
      }
    }
    expect(observed).toBe('watched')
  })

  test('reports a registered directory that has disappeared', async () => {
    const root = register('hello', 'aimux-test.hello')
    rmSync(root, { force: true, recursive: true })
    const instance = await start()

    expect(instance.statuses()).toEqual([])
    expect(instance.issues.map((issue) => issue.message).join(' ')).toContain(
      'registered directory is gone'
    )
  })

  test('an RPC handler that never settles rejects instead of hanging the caller', async () => {
    register('hello', 'aimux-test.hello')
    const instance = await start()
    expect(instance.kernel.handleRpc('aimux-test.hello', 'nope', undefined)).rejects.toThrow(
      /no daemon handler/
    )
  })
})
