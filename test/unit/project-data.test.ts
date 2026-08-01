import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ensureSetupScriptStub,
  getSetupScriptPath,
  hasSetupScript,
} from '../../src/state/project-data'

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
const dirs: string[] = []

function withHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aimux-project-data-'))
  dirs.push(dir)
  process.env.HOME = dir
  return dir
}

afterEach(() => {
  process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('setup script path', () => {
  test('honours a profile set after module import', () => {
    const home = withHome()
    process.env.AIMUX_PROFILE = 'work'

    // The path must be resolved per call: --profile is applied after imports,
    // so a module-cached path would point at the default profile.
    expect(getSetupScriptPath('proj-1')).toBe(
      join(home, '.config', 'aimux', 'work', 'projects', 'proj-1', 'setup.sh')
    )
  })

  test('ensureSetupScriptStub creates an executable stub once', () => {
    withHome()
    expect(hasSetupScript('proj-1')).toBe(false)

    const path = ensureSetupScriptStub('proj-1')
    expect(hasSetupScript('proj-1')).toBe(true)
    expect(readFileSync(path, 'utf8')).toStartWith('#!/usr/bin/env bash\n')
    expect(statSync(path).mode & 0o111).not.toBe(0)

    // Second call must not clobber the user's edits.
    Bun.spawnSync(['sh', '-c', `echo 'echo mine' > ${path}`])
    expect(ensureSetupScriptStub('proj-1')).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe('echo mine\n')
  })
})
