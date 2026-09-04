import { PLUGIN_API_VERSION, type PluginManifest } from '@brimveyn/aimux-plugin'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PluginRecord } from '../../src/plugins/types'
import type { SettingCtx, SettingRow } from '../../src/settings/types'

import { SECRET_PLACEHOLDER } from '../../src/plugins/config-origin'
import { clearPluginStore, publishPluginRecords } from '../../src/plugins/plugin-store'
import { getPluginOverride, setPluginOverride } from '../../src/plugins/registry-file'
import { buildPluginConfigSection } from '../../src/settings/plugin-config-rows'
import { PLUGINS_SECTION } from '../../src/settings/sections/plugins'
import { readRow, resetRow, writeRow } from '../../src/settings/settings-store'
import { createInitialState } from '../../src/state/store'

/**
 * The settings screen's half of the plugin control surface.
 *
 * The rows are generated from the manifest's `config` schema — the same
 * declaration the host reads before running any of the plugin's code — because
 * a second copy is a copy that rots. What they must never do is put a secret
 * on screen.
 */

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE

let tempHome = ''

const MANIFEST: PluginManifest = {
  apiVersion: PLUGIN_API_VERSION,
  config: {
    botToken: { label: 'Bot token', secret: true, type: 'string' },
    pollSeconds: { default: 3, label: 'Poll every', type: 'number' },
    verbose: { default: false, label: 'Verbose', type: 'boolean' },
  },
  id: 'acme.thing',
  name: 'Thing',
  version: '1.0.0',
}

function record(config: Record<string, unknown>): PluginRecord {
  return {
    config,
    enabled: true,
    enabledFrom: 'default',
    id: 'acme.thing',
    keymaps: [],
    manifest: MANIFEST,
    paths: { config: '/c', log: '/l', root: '/r', state: '/s' },
    root: '/r',
    source: 'link',
  }
}

function rowsOf(
  config: Record<string, unknown>,
  userConfig?: Record<string, unknown>
): SettingRow[] {
  const section = buildPluginConfigSection(record(config), userConfig)
  return section === null ? [] : (section.rows as SettingRow[])
}

function rowNamed(rows: SettingRow[], field: string): SettingRow {
  const row = rows.find((entry) => entry.id === `plugin.acme.thing.${field}`)
  if (!row) throw new Error(`no row for ${field}`)
  return row
}

const CTX: SettingCtx = { state: createInitialState(), values: {} }

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-plugin-rows-'))
  mkdirSync(tempHome, { recursive: true })
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'rows-test'
  clearPluginStore()
})

afterEach(() => {
  clearPluginStore()
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  rmSync(tempHome, { force: true, recursive: true })
})

describe('rows generated from a manifest schema', () => {
  test('one row per declared field, in the declared kind', () => {
    const rows = rowsOf({ pollSeconds: 3, verbose: false })

    expect(rowNamed(rows, 'pollSeconds').kind).toBe('number')
    expect(rowNamed(rows, 'verbose').kind).toBe('toggle')
    expect(rowNamed(rows, 'botToken').kind).toBe('text')
  })

  test('a plugin that declares no config gets no section', () => {
    // A heading with nothing under it is what the cursor logic goes out of its
    // way to avoid.
    const bare = { ...record({}), manifest: { ...MANIFEST, config: undefined } }
    expect(buildPluginConfigSection(bare, undefined)).toBeNull()
  })

  test('reading goes to the resolved value, not to the settings block', () => {
    expect(readRow(rowNamed(rowsOf({ pollSeconds: 30 }), 'pollSeconds'), CTX)).toBe(30)
  })

  test('writing goes to the registry override, and one key at a time', () => {
    writeRow(rowNamed(rowsOf({ pollSeconds: 3 }), 'pollSeconds'), 30, CTX)
    writeRow(rowNamed(rowsOf({ verbose: false }), 'verbose'), true, CTX)

    expect(getPluginOverride('acme.thing')?.config).toEqual({ pollSeconds: 30, verbose: true })
  })

  test('reset drops the override and falls back through the layers', () => {
    setPluginOverride('acme.thing', { config: { pollSeconds: 30 } })
    resetRow(rowNamed(rowsOf({ pollSeconds: 30 }), 'pollSeconds'))

    expect(getPluginOverride('acme.thing')).toBeUndefined()
  })
})

describe('a secret never reaches the screen', () => {
  test('the row reads the placeholder, not the token', () => {
    const row = rowNamed(rowsOf({ botToken: 'hunter2' }), 'botToken')

    // Redacted by the *reader*, so the value, the footer's full-value line and
    // the edit modal's seed are all covered by one rule rather than three.
    expect(readRow(row, CTX)).toBe(SECRET_PLACEHOLDER)
  })

  test('an unset secret reads as empty, which is what "unset" looks like', () => {
    expect(readRow(rowNamed(rowsOf({}), 'botToken'), CTX)).toBe('')
  })
})

describe('the marks a plugin row carries', () => {
  test('a value the config file declares is marked as coming back on restart', () => {
    const rows = rowsOf({ pollSeconds: 30 }, { pollSeconds: 30 })
    const row = rowNamed(rows, 'pollSeconds')

    expect(row.kind !== 'info' && row.kind !== 'action' && row.storage === 'plugin').toBe(true)
    if (row.kind !== 'info' && row.kind !== 'action' && row.storage === 'plugin') {
      expect(row.fromConfigFile).toBe(true)
    }
  })

  test('an untouched value is marked as neither', () => {
    const row = rowNamed(rowsOf({ pollSeconds: 3 }), 'pollSeconds')
    if (row.kind !== 'info' && row.kind !== 'action' && row.storage === 'plugin') {
      expect(row.isSet).toBe(false)
      expect(row.fromConfigFile).toBe(false)
    }
  })
})

describe('the Plugins section', () => {
  test('two rows per plugin, and rowCount agrees without building them', () => {
    publishPluginRecords([record({}), { ...record({}), id: 'acme.other' }], [])

    const rows = typeof PLUGINS_SECTION.rows === 'function' ? PLUGINS_SECTION.rows([]) : []
    // The reducer counts rows without building them; a disagreement would put
    // the cursor on a row nobody drew.
    expect(rows).toHaveLength(4)
    expect(PLUGINS_SECTION.rowCount?.([])).toBe(4)
  })

  test('the switch reads the record and writes an override', () => {
    publishPluginRecords([record({})], [])
    const rows = typeof PLUGINS_SECTION.rows === 'function' ? PLUGINS_SECTION.rows([]) : []
    const toggle = rows[0]
    if (!toggle) throw new Error('no toggle row')

    expect(readRow(toggle, CTX)).toBe(true)
    writeRow(toggle, false, CTX)
    expect(getPluginOverride('acme.thing')).toEqual({ enabled: false })
  })
})
