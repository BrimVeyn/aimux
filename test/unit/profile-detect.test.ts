import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listRunningProfiles, resolveAmbientProfile } from '../../src/profile-detect'

/**
 * Which profile a bare command talks to.
 *
 * A shell that never exported `AIMUX_PROFILE` gets `default` — right for a
 * person, whose shell and aimux share an environment, and wrong for an agent,
 * whose shell has none of it. Linking a plugin into a profile nobody is looking
 * at succeeds, reports success, and shows nothing.
 */

let root = ''
const originalRuntime = process.env.XDG_RUNTIME_DIR
const originalProfile = process.env.AIMUX_PROFILE

function daemonAt(profile: string, pid: number): void {
  const dir = join(root, `aimux-${profile}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'daemon.pid'), `${pid}\n`, 'utf8')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aimux-profiles-'))
  process.env.XDG_RUNTIME_DIR = root
  delete process.env.AIMUX_PROFILE
})

afterEach(() => {
  if (originalRuntime === undefined) delete process.env.XDG_RUNTIME_DIR
  else process.env.XDG_RUNTIME_DIR = originalRuntime
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  rmSync(root, { force: true, recursive: true })
})

test('a pid file whose process is gone is not a running profile', () => {
  daemonAt('dev', process.pid)
  // A pid that cannot exist: a crashed daemon's leftovers.
  daemonAt('ghost', 2 ** 30)

  expect(listRunningProfiles()).toEqual(['dev'])
})

test('one running profile answers for itself', () => {
  daemonAt('dev', process.pid)
  expect(resolveAmbientProfile()).toMatchObject({ from: 'only-running', profile: 'dev' })
})

test('nothing running keeps the documented default', () => {
  expect(resolveAmbientProfile()).toMatchObject({ from: 'default', profile: 'default' })
})

test('several running, with default among them, keeps default', () => {
  daemonAt('default', process.pid)
  daemonAt('dev', process.pid)
  expect(resolveAmbientProfile()).toMatchObject({ from: 'default', profile: 'default' })
})

test('several running and none of them default has no honest answer', () => {
  daemonAt('dev', process.pid)
  daemonAt('review', process.pid)
  // The caller refuses on this and asks for AIMUX_PROFILE, rather than picking
  // one of someone's two sessions.
  expect(resolveAmbientProfile()).toMatchObject({ from: 'ambiguous', running: ['dev', 'review'] })
})

test('an explicit AIMUX_PROFILE always wins, running or not', () => {
  daemonAt('dev', process.pid)
  process.env.AIMUX_PROFILE = 'review'
  expect(resolveAmbientProfile()).toMatchObject({ from: 'env', profile: 'review' })
})
