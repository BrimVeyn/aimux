import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import pkg from '../../package.json'
import { resolveHookScriptPath } from '../../src/builtin-plugins/claude/hooks-install'

const ROOT = new URL('../..', import.meta.url).pathname

/**
 * `files` is the npm tarball manifest. Anything a runtime code path resolves
 * from disk has to be in it, or the feature degrades silently on an installed
 * aimux while working perfectly from a git checkout — exactly how the Claude
 * hook bridge shipped broken for several releases.
 */
describe('package.json files', () => {
  test('publishes the Claude hook script the runtime resolves', () => {
    expect(pkg.files).toContain('assets/claude-hooks')
    expect(existsSync(join(ROOT, 'assets', 'claude-hooks', 'aimux-agent-state.sh'))).toBe(true)
  })

  test('resolveHookScriptPath finds the shipped script', () => {
    const path = resolveHookScriptPath()
    expect(path).not.toBeNull()
    expect(path).toContain(join('assets', 'claude-hooks', 'aimux-agent-state.sh'))
  })

  test('every published entry exists in the repo', () => {
    for (const entry of pkg.files) {
      expect({ entry, exists: existsSync(join(ROOT, entry)) }).toEqual({ entry, exists: true })
    }
  })
})
