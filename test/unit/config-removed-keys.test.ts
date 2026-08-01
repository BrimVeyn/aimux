import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { getConfigPath, loadConfigResult } from '../../src/config'

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
const originalRuntimeProfile = process.env.AIMUX_RUNTIME_PROFILE
const dirs: string[] = []

/**
 * Writes to wherever the loader will actually look, rather than to a path this
 * test assembles itself: the profile comes from the environment, so a guessed
 * `…/aimux/default/aimux.json` silently misses whenever a profile is set — which
 * is how this test passed locally and reported no issues on CI.
 */
function writeConfig(body: Record<string, unknown>): void {
  const home = mkdtempSync(join(tmpdir(), 'aimux-removed-keys-'))
  dirs.push(home)
  process.env.HOME = home
  delete process.env.AIMUX_PROFILE
  delete process.env.AIMUX_RUNTIME_PROFILE

  const path = getConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ version: 2, ...body }))
}

function restore(name: 'AIMUX_PROFILE' | 'AIMUX_RUNTIME_PROFILE', value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(() => {
  process.env.HOME = originalHome
  restore('AIMUX_PROFILE', originalProfile)
  restore('AIMUX_RUNTIME_PROFILE', originalRuntimeProfile)
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

/**
 * An unknown key parses fine, so a config that still declares templates would
 * silently stop doing anything. The doctor's `issues` list is the only place
 * that can tell the user.
 */
test('a config still declaring workspaceTemplates is reported, not ignored', () => {
  writeConfig({ workspaceTemplates: [{ id: 'x', name: 'X', tabs: [] }] })

  const result = loadConfigResult()
  // Guards the guard: an unreadable path reports no issues at all, which is
  // indistinguishable from "nothing to report" unless the source is checked.
  expect(result.source).toBe('file')
  expect(result.issues).toEqual([
    'workspaceTemplates was removed — use a per-project setup script instead',
  ])
})

test('the pre-rename spelling is reported too', () => {
  writeConfig({ worktreeTemplates: [] })

  expect(loadConfigResult().issues).toHaveLength(1)
})

test('a config without them loads clean', () => {
  writeConfig({ customCommands: {} })

  const result = loadConfigResult()
  expect(result.source).toBe('file')
  expect(result.issues).toEqual([])
})
