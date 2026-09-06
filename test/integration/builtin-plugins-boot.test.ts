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

/**
 * `ai-usage` ships off — it reads a keychain entry and calls two OAuth
 * endpoints — so every boot here asks for it explicitly. Otherwise the test
 * that exists to catch a failing `apply` would stop looking at the half most
 * likely to have one.
 */
const ASK_FOR_AI_USAGE = { enabled: true, id: 'aimux.ai-usage' }

async function startUiHost(): Promise<PluginRuntime> {
  const resolved = resolveConfig({})
  const instance = new PluginRuntime({
    builtins: builtinPlugins(resolved),
    extendContext: extendUiPluginContext,
    host: 'ui',
    transport: TRANSPORT,
    userPlugins: [...resolved.plugins, ASK_FOR_AI_USAGE],
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
    expect(statuses.map((status) => status.id).sort()).toEqual([
      'aimux.ai-usage',
      'aimux.auto-commit',
      'aimux.claude',
    ])
  })

  test('the quota tile is not spawned on a boot that never asked for it', async () => {
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

    // Known, listed, switchable — just not loaded. A plugin that reads
    // credentials has to be asked for, and "off" is nothing running at all.
    expect(instance.statuses().map((status) => status.id)).not.toContain('aimux.ai-usage')
    expect(instance.knownRecords().map((record) => record.id)).toContain('aimux.ai-usage')
  })

  test('and unloads without leaving anything behind', async () => {
    const instance = await startUiHost()
    for (const status of instance.statuses()) await instance.kernel.unload(status.id)

    expect(instance.statuses()).toEqual([])
  })

  test('the daemon runs the half that is its own, and knows all of them', async () => {
    const resolved = resolveConfig({})
    const instance = new PluginRuntime({
      builtins: builtinPlugins(resolved),
      host: 'daemon',
      transport: TRANSPORT,
      userPlugins: [...resolved.plugins, ASK_FOR_AI_USAGE],
    })
    runtime = instance
    await instance.start()

    // `auto-rename` is the daemon-half built-in: it reacts to prompts and
    // writes titles, neither of which the UI can do. The other two are UI-only,
    // and the daemon must still list them — `aimux plugin list` would otherwise
    // deny the existence of a plugin that is running.
    expect(instance.statuses().map((status) => status.id)).toEqual(['aimux.auto-rename'])
    expect(
      instance
        .knownRecords()
        .map((record) => record.id)
        .sort()
    ).toEqual(['aimux.ai-usage', 'aimux.auto-commit', 'aimux.auto-rename', 'aimux.claude'])
  })
})
