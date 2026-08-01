import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadConfigResult } from '../../src/config'

const originalHome = process.env.HOME
const dirs: string[] = []

function writeConfig(body: Record<string, unknown>): void {
  const home = mkdtempSync(join(tmpdir(), 'aimux-removed-keys-'))
  dirs.push(home)
  process.env.HOME = home
  const dir = join(home, '.config', 'aimux', 'default')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'aimux.json'), JSON.stringify({ version: 2, ...body }))
}

afterEach(() => {
  process.env.HOME = originalHome
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

/**
 * An unknown key parses fine, so a config that still declares templates would
 * silently stop doing anything. The doctor's `issues` list is the only place
 * that can tell the user.
 */
test('a config still declaring workspaceTemplates is reported, not ignored', () => {
  writeConfig({ workspaceTemplates: [{ id: 'x', name: 'X', tabs: [] }] })

  expect(loadConfigResult().issues).toEqual([
    'workspaceTemplates was removed — use a per-project setup script instead',
  ])
})

test('the pre-rename spelling is reported too', () => {
  writeConfig({ worktreeTemplates: [] })

  expect(loadConfigResult().issues).toHaveLength(1)
})

test('a config without them loads clean', () => {
  writeConfig({ customCommands: {} })

  expect(loadConfigResult().issues).toEqual([])
})
