import { PLUGIN_API_VERSION } from '@brimveyn/aimux-plugin'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BuiltinPlugin } from '../../src/plugins/builtin'

import { discoverPlugins } from '../../src/plugins/discovery'
import { setPluginOverride } from '../../src/plugins/registry-file'

/**
 * The precedence ladder, end to end, for the one thing every plugin kind used
 * to disagree about: whether it is on.
 *
 * A built-in had no registry row, so `plugin disable` could only apologise and
 * point at `aimux.config.ts`. Moving the decision into an `overrides` map keyed
 * by id means the four kinds behave alike — and this is where that is checked,
 * because it is a claim about discovery rather than about any one file.
 */

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE

let tempHome = ''

const DEMO: BuiltinPlugin = {
  config: { seeded: 'from-builtin' },
  halves: { daemon: async () => ({ apply: () => {} }) },
  manifest: {
    apiVersion: PLUGIN_API_VERSION,
    config: {
      seeded: { default: 'from-manifest', type: 'string' },
      tuned: { default: 'default', type: 'string' },
    },
    id: 'aimux.demo',
    version: '1.0.0',
  },
}

async function recordFor(userPlugins: Parameters<typeof discoverPlugins>[0] = []) {
  const { records } = await discoverPlugins(userPlugins, undefined, [DEMO])
  return records.find((record) => record.id === 'aimux.demo')
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-overrides-'))
  mkdirSync(tempHome, { recursive: true })
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'overrides-test'
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  rmSync(tempHome, { force: true, recursive: true })
})

describe('enabling a plugin that has no registry row', () => {
  test('on by default, and it says nobody decided', async () => {
    const record = await recordFor()
    expect(record?.enabled).toBe(true)
    expect(record?.enabledFrom).toBe('default')
  })

  test('an override turns a built-in off', async () => {
    setPluginOverride('aimux.demo', { enabled: false })

    const record = await recordFor()
    expect(record?.enabled).toBe(false)
    expect(record?.enabledFrom).toBe('registry')
  })

  test('aimux.config.ts outranks the override, in both directions', async () => {
    setPluginOverride('aimux.demo', { enabled: false })

    // The file re-enables it. `enabledFrom` is what tells an agent its
    // `plugin enable` would land in a layer nobody reads.
    const on = await recordFor([{ enabled: true, id: 'aimux.demo' }])
    expect(on?.enabled).toBe(true)
    expect(on?.enabledFrom).toBe('config')

    setPluginOverride('aimux.demo', { enabled: true })
    const off = await recordFor([{ enabled: false, id: 'aimux.demo' }])
    expect(off?.enabled).toBe(false)
    expect(off?.enabledFrom).toBe('config')
  })
})

describe('the config ladder', () => {
  test('manifest default, then the built-in seed', async () => {
    const record = await recordFor()
    expect(record?.config).toEqual({ seeded: 'from-builtin', tuned: 'default' })
  })

  test('an override outranks both', async () => {
    setPluginOverride('aimux.demo', { config: { seeded: 'from-override' } })

    const record = await recordFor()
    expect(record?.config.seeded).toBe('from-override')
  })

  test('and aimux.config.ts outranks the override', async () => {
    setPluginOverride('aimux.demo', { config: { seeded: 'from-override' } })

    const record = await recordFor([{ config: { seeded: 'from-file' }, id: 'aimux.demo' }])
    expect(record?.config.seeded).toBe('from-file')
  })

  test('one key set does not disturb the others', async () => {
    setPluginOverride('aimux.demo', { config: { tuned: 'edited' } })

    const record = await recordFor()
    expect(record?.config).toEqual({ seeded: 'from-builtin', tuned: 'edited' })
  })
})
