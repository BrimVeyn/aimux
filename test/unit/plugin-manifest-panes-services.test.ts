import { describe, expect, test } from 'bun:test'

import { parseManifest } from '../../src/plugins/manifest'

/**
 * `panes[]` and `services[]` are the two manifest blocks a plugin with no
 * TypeScript at all lives on, so a malformed one has to be named field by
 * field — the author fixing it is as often an agent as a human.
 */
const BASE = { apiVersion: 1, id: 'acme.tools', version: '1.0.0' }

describe('manifest panes[]', () => {
  test('a pane alone is a valid plugin', () => {
    const result = parseManifest({
      ...BASE,
      panes: [{ command: ['lazygit'], cwd: 'workspace', id: 'lazygit', title: 'lazygit' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.panes).toEqual([
      { command: ['lazygit'], cwd: 'workspace', id: 'lazygit', title: 'lazygit' },
    ])
  })

  test('a shell string is refused, by field', () => {
    const result = parseManifest({ ...BASE, panes: [{ command: 'lazygit -w', id: 'lazygit' }] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.field)).toContain('panes[0].command')
  })
})

describe('manifest services[]', () => {
  test('restart defaults are left to the supervisor; a bad policy is named', () => {
    const ok = parseManifest({ ...BASE, services: [{ command: ['./relay'], id: 'relay' }] })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.manifest.services?.[0]?.restart).toBeUndefined()

    const bad = parseManifest({
      ...BASE,
      services: [{ command: ['./relay'], id: 'relay', restart: 'sometimes' }],
    })
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.issues[0]?.field).toBe('services[0].restart')
  })

  test('a plugin that declares nothing at all is still refused', () => {
    const result = parseManifest({ ...BASE, panes: [], services: [] })
    expect(result.ok).toBe(false)
  })
})
