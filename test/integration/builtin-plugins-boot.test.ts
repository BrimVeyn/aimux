import { resolveConfig } from '@brimveyn/aimux-config'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PluginRpcTransport } from '../../src/plugins/types'

import { builtinPlugins } from '../../src/builtin-plugins'
import { PluginRuntime } from '../../src/plugins/loader'
import { extendUiPluginContext } from '../../src/ui/plugin-ui-services'

/**
 * Does aimux load its own plugins?
 *
 * The production wiring, minus the screen: the real built-in list, the real UI
 * services, the real kernel. Everything the app does at boot except render —
 * which is what a plugin's `apply` does not touch anyway. A lazy import that
 * fails to resolve, or an `apply` that throws against the real service objects,
 * shows up here rather than as an empty status bar.
 */

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
const originalWatch = process.env.AIMUX_PLUGIN_WATCH

let tempHome = ''
let runtime: PluginRuntime | null = null

const TRANSPORT: PluginRpcTransport = { broadcast: () => {}, call: async () => null }

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-builtin-boot-'))
  mkdirSync(tempHome, { recursive: true })
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'builtin-boot'
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

async function startUiHost(): Promise<PluginRuntime> {
  const resolved = resolveConfig({})
  const instance = new PluginRuntime({
    builtins: builtinPlugins(resolved),
    extendContext: extendUiPluginContext,
    host: 'ui',
    transport: TRANSPORT,
    userPlugins: resolved.plugins,
  })
  runtime = instance
  await instance.start()
  return instance
}

describe('the plugins aimux ships', () => {
  test('every shipped UI half loads against the real services', async () => {
    const instance = await startUiHost()

    const statuses = instance.statuses()
    expect(statuses.length).toBeGreaterThan(0)
    for (const status of statuses) {
      // A failed fiber carries its error; asserting on the message first makes
      // the failure readable instead of "expected 'failed' to be 'active'".
      expect(status.error).toBeUndefined()
      expect(status.state).toBe('active')
      expect(status.source).toBe('builtin')
    }
    expect(statuses.map((status) => status.id).sort()).toEqual(['aimux.ai-usage', 'aimux.claude'])
  })

  test('and unloads without leaving anything behind', async () => {
    const instance = await startUiHost()
    for (const status of instance.statuses()) await instance.kernel.unload(status.id)

    expect(instance.statuses()).toEqual([])
  })

  test('the daemon runs none of them, and still knows all of them', async () => {
    const resolved = resolveConfig({})
    const instance = new PluginRuntime({
      builtins: builtinPlugins(resolved),
      host: 'daemon',
      transport: TRANSPORT,
      userPlugins: resolved.plugins,
    })
    runtime = instance
    await instance.start()

    // Both are UI-only today. The daemon must still list them, or
    // `aimux plugin list` would deny the existence of a running plugin.
    expect(instance.statuses()).toEqual([])
    expect(
      instance
        .knownRecords()
        .map((record) => record.id)
        .sort()
    ).toEqual(['aimux.ai-usage', 'aimux.claude'])
  })
})
