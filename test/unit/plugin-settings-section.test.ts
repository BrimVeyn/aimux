import type { PluginManifest } from '@brimveyn/aimux-plugin'

import { afterEach, describe, expect, test } from 'bun:test'

import { buildPluginSettingSection, pluginSettingRowId } from '../../src/settings/plugin-section'
import { filterSettingRows } from '../../src/settings/search'
import {
  BUILTIN_SETTING_SECTIONS,
  clearSettingSections,
  getSection,
  registerSettingSection,
  settingSections,
  totalRowCount,
} from '../../src/settings/sections'

/**
 * A plugin declares its config once, in the manifest, because the host reads
 * it before running any plugin code. The settings rows are generated from that
 * same declaration — writing the schema twice is how the two copies come to
 * disagree.
 */

const MANIFEST: PluginManifest = {
  apiVersion: 1,
  config: {
    botToken: { required: true, secret: true, type: 'string' },
    enabled: { default: true, label: 'Enabled', type: 'boolean' },
    intervalMs: { default: 60_000, description: 'How often to poll.', type: 'number' },
  },
  description: 'Sends a message when a turn ends.',
  id: 'acme.telegram',
  name: 'Telegram notify',
  version: '1.0.0',
}

afterEach(() => {
  clearSettingSections()
})

describe('generated plugin settings section', () => {
  test('one row per declared field, keyed by plugin and field', () => {
    const section = buildPluginSettingSection(MANIFEST)
    expect(section).not.toBeNull()
    if (!section) return

    expect(section.id).toBe('plugin.acme.telegram')
    expect(section.label).toBe('Telegram notify')
    expect(section.description).toBe('Sends a message when a turn ends.')

    const rows = Array.isArray(section.rows) ? section.rows : []
    expect(rows.map((row) => row.id)).toEqual([
      pluginSettingRowId('acme.telegram', 'botToken'),
      pluginSettingRowId('acme.telegram', 'enabled'),
      pluginSettingRowId('acme.telegram', 'intervalMs'),
    ])
  })

  test('each field type maps to the row kind that can edit it', () => {
    const section = buildPluginSettingSection(MANIFEST)
    const rows = section && Array.isArray(section.rows) ? section.rows : []
    const byId = new Map(rows.map((row) => [row.id, row]))

    expect(byId.get('plugin.acme.telegram.enabled')?.kind).toBe('toggle')
    expect(byId.get('plugin.acme.telegram.intervalMs')?.kind).toBe('number')
    expect(byId.get('plugin.acme.telegram.botToken')?.kind).toBe('text')
  })

  test('a declared default becomes the row fallback', () => {
    const section = buildPluginSettingSection(MANIFEST)
    const rows = section && Array.isArray(section.rows) ? section.rows : []
    const enabled = rows.find((row) => row.id === 'plugin.acme.telegram.enabled')
    expect(enabled && 'fallback' in enabled ? enabled.fallback : null).toBe(true)
  })

  test('a secret shows a placeholder rather than its value', () => {
    const section = buildPluginSettingSection(MANIFEST)
    const rows = section && Array.isArray(section.rows) ? section.rows : []
    const token = rows.find((row) => row.id === 'plugin.acme.telegram.botToken')
    expect(token && 'placeholder' in token ? token.placeholder : null).toBe('<secret>')
  })

  test('a label defaults to the field name', () => {
    const section = buildPluginSettingSection(MANIFEST)
    const rows = section && Array.isArray(section.rows) ? section.rows : []
    expect(rows.find((row) => row.id === 'plugin.acme.telegram.intervalMs')?.label).toBe(
      'intervalMs'
    )
  })

  test('a manifest with no config gets no section', () => {
    // A heading with nothing under it is exactly what the screen's cursor
    // logic goes out of its way to avoid.
    expect(buildPluginSettingSection({ ...MANIFEST, config: undefined })).toBeNull()
    expect(buildPluginSettingSection({ ...MANIFEST, config: {} })).toBeNull()
  })
})

describe('settings section registry', () => {
  test('a registered section lands before About, never between two built-ins', () => {
    const section = buildPluginSettingSection(MANIFEST)
    if (!section) return
    registerSettingSection(section)

    const ids = settingSections().map((entry) => entry.id)
    const about = BUILTIN_SETTING_SECTIONS.at(-1)?.id
    // The screen a user learned must not reshuffle when they install something.
    expect(ids.at(-1)).toBe(about)
    expect(ids.at(-2)).toBe('plugin.acme.telegram')
    expect(ids.slice(0, -2)).toEqual(BUILTIN_SETTING_SECTIONS.slice(0, -1).map((s) => s.id))
  })

  test('the row count and the search index both pick it up', () => {
    const before = totalRowCount([])
    const beforeHits = filterSettingRows([], 'botToken').length

    const section = buildPluginSettingSection(MANIFEST)
    if (!section) return
    const dispose = registerSettingSection(section)

    expect(totalRowCount([])).toBe(before + 3)
    expect(filterSettingRows([], 'botToken').length).toBe(beforeHits + 1)
    expect(getSection('plugin.acme.telegram')?.label).toBe('Telegram notify')

    dispose()
    expect(totalRowCount([])).toBe(before)
    expect(filterSettingRows([], 'botToken').length).toBe(beforeHits)
    expect(getSection('plugin.acme.telegram')).toBeUndefined()
  })

  test('with nothing registered the list is the built-in array itself', () => {
    // Identity, not just equality: the common case must not allocate.
    expect(settingSections()).toBe(BUILTIN_SETTING_SECTIONS)
  })
})
