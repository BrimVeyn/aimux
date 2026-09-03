import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import {
  checkHostCompatibility,
  compareVersions,
  formatManifestIssues,
  parseManifest,
  readManifest,
  redactPluginConfig,
  resolvePluginConfig,
} from '../../src/plugins/manifest'

const FIXTURES = join(new URL('..', import.meta.url).pathname, 'fixtures', 'plugins')

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiVersion: 1,
    entries: { daemon: './daemon.ts' },
    id: 'acme.thing',
    version: '1.0.0',
    ...overrides,
  }
}

function issueFields(value: unknown): string[] {
  const result = parseManifest(value)
  return result.ok ? [] : result.issues.map((issue) => issue.field)
}

describe('plugin manifest', () => {
  test('accepts a minimal well-formed manifest', () => {
    const result = parseManifest(valid())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.id).toBe('acme.thing')
    expect(result.manifest.entries?.daemon).toBe('./daemon.ts')
  })

  test('requires a dotted, lowercase id', () => {
    expect(issueFields(valid({ id: 'thing' }))).toContain('id')
    expect(issueFields(valid({ id: 'Acme.Thing' }))).toContain('id')
    expect(issueFields(valid({ id: 'acme.thing' }))).toEqual([])
  })

  test('rejects an entry that escapes the plugin directory', () => {
    expect(issueFields(valid({ entries: { daemon: '../elsewhere.ts' } }))).toContain(
      'entries.daemon'
    )
    expect(issueFields(valid({ entries: { daemon: '/etc/passwd' } }))).toContain('entries.daemon')
  })

  test('names an unknown host rather than ignoring it', () => {
    // A manifest declaring `entries.terminal` is a misunderstanding worth
    // reporting: the terminal manager loads no plugins, by rule.
    expect(issueFields(valid({ entries: { daemon: './d.ts', terminal: './t.ts' } }))).toContain(
      'entries.terminal'
    )
  })

  test('refuses a plugin that contributes nothing', () => {
    expect(issueFields(valid({ entries: {} }))).toContain('entries')
  })

  test('refuses a mismatched apiVersion and says which one it implements', () => {
    const result = parseManifest(valid({ apiVersion: 99 }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.field).toBe('apiVersion')
    expect(result.issues[0]?.message).toContain('1')
  })

  test('reports every issue at once, not just the first', () => {
    const fields = issueFields({ apiVersion: 'x', id: 'nope', version: 3 })
    expect(fields).toContain('id')
    expect(fields).toContain('version')
    expect(fields).toContain('apiVersion')
  })

  test('validates build steps as argv arrays, not shell strings', () => {
    expect(issueFields(valid({ build: ['bun install'] }))).toContain('build[0]')
    expect(issueFields(valid({ build: [['bun', 'install']] }))).toEqual([])
  })

  test('rejects a config default whose type contradicts the field', () => {
    expect(issueFields(valid({ config: { n: { default: 'x', type: 'number' } } }))).toContain(
      'config.n.default'
    )
  })

  test('formats issues with the field name in front', () => {
    expect(formatManifestIssues([{ field: 'id', message: 'must be a string' }])).toBe(
      'id: must be a string'
    )
    expect(formatManifestIssues([{ field: '', message: 'not JSON' }])).toBe('not JSON')
  })
})

describe('plugin manifest — host compatibility', () => {
  test('compares versions numerically, ignoring a prerelease suffix', () => {
    expect(compareVersions('1.24.0', '1.23.7')).toBe(1)
    expect(compareVersions('1.23.7', '1.24.0')).toBe(-1)
    expect(compareVersions('1.24.0-beta.1', '1.24.0')).toBe(0)
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1)
  })

  test('flags a plugin needing a newer aimux', () => {
    const manifest = parseManifest(valid({ minAimuxVersion: '2.0.0' }))
    expect(manifest.ok).toBe(true)
    if (!manifest.ok) return
    const issues = checkHostCompatibility(manifest.manifest, '1.23.7')
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('2.0.0')
    expect(checkHostCompatibility(manifest.manifest, '2.1.0')).toEqual([])
  })
})

describe('plugin config resolution', () => {
  const manifest = {
    apiVersion: 1,
    config: {
      greeting: { default: 'hello', type: 'string' as const },
      token: { required: true, secret: true, type: 'string' as const },
    },
    id: 'acme.thing',
    version: '1.0.0',
  }

  test('applies defaults, then registry, then user config', () => {
    const { config } = resolvePluginConfig(
      manifest,
      { greeting: 'from-registry', token: 't' },
      { greeting: 'from-user' }
    )
    expect(config.greeting).toBe('from-user')
    expect(config.token).toBe('t')
  })

  test('drops a value of the wrong type instead of coercing it', () => {
    const { config, issues } = resolvePluginConfig(manifest, { greeting: 42, token: 't' })
    expect(config.greeting).toBe('hello')
    expect(issues.map((issue) => issue.field)).toContain('config.greeting')
  })

  test('reports a missing required field', () => {
    const { issues } = resolvePluginConfig(manifest, {})
    expect(issues.map((issue) => issue.field)).toContain('config.token')
  })

  test('passes through keys the schema does not describe', () => {
    const { config } = resolvePluginConfig(manifest, { token: 't', undeclared: 1 })
    expect(config.undeclared).toBe(1)
  })

  test('redacts secrets for display', () => {
    const redacted = redactPluginConfig(manifest, { greeting: 'hi', token: 'super-secret' })
    expect(redacted.token).toBe('<secret>')
    expect(redacted.greeting).toBe('hi')
  })
})

describe('plugin manifest — reading from disk', () => {
  test('reads a fixture manifest', async () => {
    const result = await readManifest(join(FIXTURES, 'hello'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.id).toBe('aimux-test.hello')
    expect(Object.keys(result.manifest.entries ?? {}).sort()).toEqual(['daemon', 'ui'])
  })

  test('reports a missing manifest by path', async () => {
    const result = await readManifest(join(FIXTURES, 'does-not-exist'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.message).toContain('aimux-plugin.json')
  })
})
