import { definePlugin, PLUGIN_API_VERSION } from '@brimveyn/aimux-plugin'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BuiltinPlugin } from '../../src/plugins/builtin'
import type { PluginRpcTransport } from '../../src/plugins/types'

import { discoverPlugins } from '../../src/plugins/discovery'
import { PluginRuntime } from '../../src/plugins/loader'

/**
 * A built-in is the same plugin as any other, minus the disk.
 *
 * That claim is the whole reason phase 4 exists: if shipping a feature as a
 * plugin needed a privileged path through the kernel, the API would be proving
 * nothing. So the assertions here are deliberately about sameness — one fiber,
 * one effect stack, the same config precedence, the same enable switch.
 */

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
const originalWatch = process.env.AIMUX_PLUGIN_WATCH

let tempHome = ''
let runtime: PluginRuntime | null = null

const TRANSPORT: PluginRpcTransport = { broadcast: () => {}, call: async () => null }

/** What the half did, so a test can see an unload actually unwound. */
const trace: string[] = []

function demo(overrides: Partial<BuiltinPlugin['manifest']> = {}): BuiltinPlugin {
  return {
    halves: {
      daemon: async () =>
        definePlugin({
          apply(ctx) {
            trace.push(
              `apply:${typeof ctx.config.greeting === 'string' ? ctx.config.greeting : 'none'}`
            )
            ctx.effect(() => () => {
              trace.push('dispose')
            })
          },
        }),
    },
    manifest: {
      apiVersion: PLUGIN_API_VERSION,
      config: { greeting: { default: 'hello', type: 'string' } },
      id: 'aimux.demo',
      name: 'Demo',
      version: '1.0.0',
      ...overrides,
    },
  }
}

async function start(builtins: readonly BuiltinPlugin[]): Promise<PluginRuntime> {
  const instance = new PluginRuntime({
    builtins,
    host: 'daemon',
    transport: TRANSPORT,
    userPlugins: [],
  })
  runtime = instance
  await instance.start()
  return instance
}

beforeEach(() => {
  trace.length = 0
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-builtin-'))
  mkdirSync(tempHome, { recursive: true })
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'builtin-test'
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

describe('built-in plugins', () => {
  test('a built-in loads with nothing on disk', async () => {
    const instance = await start([demo()])

    const [status] = instance.statuses()
    expect(status?.id).toBe('aimux.demo')
    expect(status?.state).toBe('active')
    expect(status?.source).toBe('builtin')
    // One fiber, one effect stack — not a shortcut past the kernel.
    expect(status?.effects).toBe(1)
    expect(trace).toEqual(['apply:hello'])
  })

  test('unloading unwinds it exactly like any other plugin', async () => {
    const instance = await start([demo()])
    await instance.kernel.unload('aimux.demo')

    expect(trace).toEqual(['apply:hello', 'dispose'])
    expect(instance.statuses()).toEqual([])
  })

  test('reloading re-applies without touching the module loader', async () => {
    const instance = await start([demo()])
    await instance.reload('aimux.demo')

    expect(trace).toEqual(['apply:hello', 'dispose', 'apply:hello'])
    expect(instance.statuses()[0]?.revision).toBe(2)
  })

  test('aimux.config.ts configures a built-in through the manifest schema', async () => {
    const instance = new PluginRuntime({
      builtins: [demo()],
      host: 'daemon',
      transport: TRANSPORT,
      userPlugins: [{ config: { greeting: 'bonjour' }, id: 'aimux.demo' }],
    })
    runtime = instance
    await instance.start()

    expect(trace).toEqual(['apply:bonjour'])
  })

  test('aimux.config.ts switches a built-in off', async () => {
    const instance = new PluginRuntime({
      builtins: [demo()],
      host: 'daemon',
      transport: TRANSPORT,
      userPlugins: [{ enabled: false, id: 'aimux.demo' }],
    })
    runtime = instance
    await instance.start()

    // Still known — `plugin list` shows it as disabled rather than hiding it.
    expect(instance.knownRecords().map((record) => record.id)).toEqual(['aimux.demo'])
    expect(instance.statuses()).toEqual([])
    expect(trace).toEqual([])
  })

  test('configuring a built-in is not reported as an unknown plugin', async () => {
    const { issues } = await discoverPlugins([{ id: 'aimux.demo' }], undefined, [demo()])
    expect(issues).toEqual([])
  })

  test('a built-in half the host does not run spawns no fiber', async () => {
    const uiOnly: BuiltinPlugin = {
      halves: { ui: async () => definePlugin({ apply: () => {} }) },
      manifest: { apiVersion: PLUGIN_API_VERSION, id: 'aimux.uionly', version: '1.0.0' },
    }
    const instance = await start([uiOnly])

    expect(instance.statuses()).toEqual([])
    expect(instance.knownRecords().map((record) => record.id)).toEqual(['aimux.uionly'])
  })

  test('a malformed built-in manifest is an issue, not a crash', async () => {
    const { issues, records } = await discoverPlugins([], undefined, [
      demo({ id: 'nodot' } as Partial<BuiltinPlugin['manifest']>),
    ])
    expect(records).toEqual([])
    expect(issues[0]?.message).toContain('built-in manifest is invalid')
  })
})
