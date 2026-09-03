import { PLUGIN_API_VERSION } from '@brimveyn/aimux-plugin'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCli } from '../../src/cli'
import { getPluginOverride, upsertPluginRegistryEntry } from '../../src/plugins/registry-file'

/**
 * The verbs an agent uses. Every one of them is a write into a file the agent
 * cannot see, so the contract that matters is the one on failure: a key that
 * does not exist, or a value the declared type refuses, must fail loudly
 * rather than land somewhere no plugin reads.
 */

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE

let tempHome = ''
let pluginRoot = ''

const MANIFEST = {
  apiVersion: PLUGIN_API_VERSION,
  config: {
    botToken: { label: 'Bot token', secret: true, type: 'string' },
    pollSeconds: { default: 3, label: 'Poll every', type: 'number' },
    verbose: { default: false, label: 'Verbose', type: 'boolean' },
  },
  entries: { daemon: 'daemon.ts' },
  id: 'acme.thing',
  name: 'Thing',
  version: '1.0.0',
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-plugin-config-'))
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'config-test'

  pluginRoot = join(tempHome, 'thing')
  mkdirSync(pluginRoot, { recursive: true })
  writeFileSync(join(pluginRoot, 'aimux-plugin.json'), JSON.stringify(MANIFEST))
  writeFileSync(join(pluginRoot, 'daemon.ts'), 'export default { apply() {} }\n')
  upsertPluginRegistryEntry({
    enabled: true,
    id: 'acme.thing',
    path: pluginRoot,
    source: 'link',
  })
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  rmSync(tempHome, { force: true, recursive: true })
})

describe('aimux plugin set', () => {
  test('coerces the value against the declared type', async () => {
    expect(await runCli(['plugin', 'set', 'acme.thing', 'pollSeconds', '30'])).toBe(0)
    expect(getPluginOverride('acme.thing')?.config).toEqual({ pollSeconds: 30 })

    await runCli(['plugin', 'set', 'acme.thing', 'verbose', 'true'])
    expect(getPluginOverride('acme.thing')?.config?.verbose).toBe(true)
  })

  test('refuses a value the type cannot take', async () => {
    // A loose coercion would write something `resolvePluginConfig` then drops
    // with an issue: nothing fails, and the plugin never sees it.
    expect(await runCli(['plugin', 'set', 'acme.thing', 'pollSeconds', 'soon'])).not.toBe(0)
    expect(getPluginOverride('acme.thing')).toBeUndefined()
  })

  test('refuses a key the manifest does not declare, and lists the ones it does', async () => {
    expect(await runCli(['plugin', 'set', 'acme.thing', 'pollSecond', '30'])).not.toBe(0)
    expect(getPluginOverride('acme.thing')).toBeUndefined()
  })

  test('refuses an unknown plugin', async () => {
    expect(await runCli(['plugin', 'set', 'nope.nope', 'x', '1'])).toBe(2)
  })

  test('setting one key leaves the others alone', async () => {
    await runCli(['plugin', 'set', 'acme.thing', 'pollSeconds', '30'])
    await runCli(['plugin', 'set', 'acme.thing', 'verbose', 'true'])

    expect(getPluginOverride('acme.thing')?.config).toEqual({ pollSeconds: 30, verbose: true })
  })
})

describe('aimux plugin unset', () => {
  test('removes the override and leaves what is underneath', async () => {
    await runCli(['plugin', 'set', 'acme.thing', 'pollSeconds', '30'])
    expect(await runCli(['plugin', 'unset', 'acme.thing', 'pollSeconds'])).toBe(0)

    // The last key going means the override says nothing, so it is removed
    // rather than left as an empty object.
    expect(getPluginOverride('acme.thing')).toBeUndefined()
  })

  test('refuses a key the manifest does not declare', async () => {
    expect(await runCli(['plugin', 'unset', 'acme.thing', 'nope'])).not.toBe(0)
  })
})

describe('aimux plugin enable and disable', () => {
  test('write the override rather than the row', async () => {
    expect(await runCli(['plugin', 'disable', 'acme.thing'])).toBe(0)
    expect(getPluginOverride('acme.thing')).toEqual({ enabled: false })

    expect(await runCli(['plugin', 'enable', 'acme.thing'])).toBe(0)
    expect(getPluginOverride('acme.thing')).toEqual({ enabled: true })
  })

  test('refuse an id nothing knows', async () => {
    expect(await runCli(['plugin', 'disable', 'nope.nope'])).toBe(2)
  })
})
