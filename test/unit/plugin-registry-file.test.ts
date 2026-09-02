import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getPluginRegistryFilePath } from '../../src/plugins/paths'
import {
  loadPluginRegistryResult,
  removePluginRegistryEntry,
  savePluginRegistry,
  setPluginEnabled,
  upsertPluginRegistryEntry,
} from '../../src/plugins/registry-file'

/**
 * `aimux-plugins.json` is validated per entry, like `loadConfigResult`: one
 * malformed row is dropped with an issue and the rest of the file still
 * loads. A registry that refused to parse would take every plugin down with
 * it — including the ones the user needs to diagnose the broken one.
 */

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
let tempHome = ''

function writeRegistry(contents: unknown): void {
  const path = getPluginRegistryFilePath()
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents), 'utf8')
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-plugin-registry-'))
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'registry-test'
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  rmSync(tempHome, { force: true, recursive: true })
})

describe('plugin registry file', () => {
  test('a missing file is an empty registry, not an error', () => {
    const { issues, registry } = loadPluginRegistryResult()
    expect(registry.plugins).toEqual([])
    expect(issues).toEqual([])
  })

  test('unparseable JSON yields one issue and an empty registry', () => {
    writeRegistry('{ not json')
    const { issues, registry } = loadPluginRegistryResult()
    expect(registry.plugins).toEqual([])
    expect(issues[0]).toContain('not valid JSON')
  })

  test('drops a malformed row and keeps the rest', () => {
    writeRegistry({
      plugins: [
        { enabled: true, id: 'acme.good', path: '/tmp/good', source: 'link' },
        { path: '/tmp/anonymous' },
        { id: 'acme.pathless' },
        { enabled: false, id: 'acme.also-good', path: '/tmp/also', source: 'install' },
      ],
      version: 1,
    })
    const { issues, registry } = loadPluginRegistryResult()
    expect(registry.plugins.map((entry) => entry.id)).toEqual(['acme.good', 'acme.also-good'])
    expect(issues).toHaveLength(2)
    expect(issues.join(' ')).toContain('plugins[1].id')
    expect(issues.join(' ')).toContain('plugins[2].path')
  })

  test('keeps the first of two rows sharing an id', () => {
    writeRegistry({
      plugins: [
        { id: 'acme.dup', path: '/tmp/first' },
        { id: 'acme.dup', path: '/tmp/second' },
      ],
      version: 1,
    })
    const { issues, registry } = loadPluginRegistryResult()
    expect(registry.plugins).toHaveLength(1)
    expect(registry.plugins[0]?.path).toBe('/tmp/first')
    expect(issues.join(' ')).toContain('duplicate id')
  })

  test('defaults enabled to true and source to link', () => {
    writeRegistry({ plugins: [{ id: 'acme.x', path: '/tmp/x' }], version: 1 })
    const [entry] = loadPluginRegistryResult().registry.plugins
    expect(entry?.enabled).toBe(true)
    expect(entry?.source).toBe('link')
  })

  test('flags an unsupported version but still loads the rows', () => {
    writeRegistry({ plugins: [{ id: 'acme.x', path: '/tmp/x' }], version: 99 })
    const { issues, registry } = loadPluginRegistryResult()
    expect(registry.plugins).toHaveLength(1)
    expect(issues.join(' ')).toContain('unsupported plugin registry version')
  })

  test('upsert merges rather than replacing config the caller did not set', () => {
    upsertPluginRegistryEntry({
      config: { token: 'secret' },
      enabled: true,
      id: 'acme.x',
      path: '/tmp/x',
      source: 'link',
    })
    upsertPluginRegistryEntry({ enabled: true, id: 'acme.x', path: '/tmp/moved', source: 'link' })

    const [entry] = loadPluginRegistryResult().registry.plugins
    expect(entry?.path).toBe('/tmp/moved')
    expect(entry?.config).toEqual({ token: 'secret' })
  })

  test('enable, disable, and remove', () => {
    upsertPluginRegistryEntry({ enabled: true, id: 'acme.x', path: '/tmp/x', source: 'link' })

    expect(setPluginEnabled('acme.x', false)).toBe(true)
    expect(loadPluginRegistryResult().registry.plugins[0]?.enabled).toBe(false)
    expect(setPluginEnabled('acme.missing', false)).toBe(false)

    expect(removePluginRegistryEntry('acme.x')).toBe(true)
    expect(removePluginRegistryEntry('acme.x')).toBe(false)
    expect(loadPluginRegistryResult().registry.plugins).toEqual([])
  })

  test('writes rows in a stable order so the file does not churn', () => {
    savePluginRegistry({
      plugins: [
        { enabled: true, id: 'z.last', path: '/tmp/z', source: 'link' },
        { enabled: true, id: 'a.first', path: '/tmp/a', source: 'link' },
      ],
      version: 1,
    })
    expect(loadPluginRegistryResult().registry.plugins.map((entry) => entry.id)).toEqual([
      'a.first',
      'z.last',
    ])
  })
})
