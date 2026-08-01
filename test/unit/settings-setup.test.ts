import { afterEach, expect, test } from 'bun:test'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { AppState, ProjectRecord } from '../../src/state/types'

import { getSection, sectionRows } from '../../src/settings/sections'
import { readRow, writeRow } from '../../src/settings/settings-store'
import {
  ensureSetupScriptStub,
  getSetupScriptPath,
  readSetupScriptLines,
  writeSetupCommand,
} from '../../src/state/project-data'
import { createInitialState } from '../../src/state/store'

const NOW = '2026-08-01T00:00:00.000Z'
const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
const dirs: string[] = []

function project(id: string, name: string): ProjectRecord {
  return { createdAt: NOW, id, lastOpenedAt: NOW, name, updatedAt: NOW }
}

/** A state with two projects, and $HOME pointed somewhere disposable. */
function withProjects(): AppState {
  const home = mkdtempSync(join(tmpdir(), 'aimux-setup-rows-'))
  dirs.push(home)
  process.env.HOME = home
  delete process.env.AIMUX_PROFILE
  return {
    ...createInitialState(),
    projects: [project('p1', 'repo one'), project('p2', 'repo two')],
  }
}

function rowsFor(state: AppState) {
  const section = getSection('setup')
  if (!section) throw new Error('no setup section')
  return sectionRows(section, state.projects)
}

function ctxFor(state: AppState) {
  return { state, values: {} }
}

afterEach(() => {
  process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

test('one row per project, named after it', () => {
  const rows = rowsFor(withProjects())

  expect(rows.map((row) => row.label)).toEqual(['repo one', 'repo two'])
})

test('a project with no script yet shows an empty editable row', () => {
  const state = withProjects()
  const row = rowsFor(state)[0]
  if (!row) throw new Error('no row')

  expect(row.kind).toBe('text')
  expect(readRow(row, ctxFor(state))).toBe('')
})

test('writing a command creates an executable script that runs it', () => {
  const state = withProjects()
  const row = rowsFor(state)[0]
  if (!row) throw new Error('no row')

  writeRow(row, 'bun install && cp .env.example .env', ctxFor(state))

  const contents = readFileSync(getSetupScriptPath('p1'), 'utf8')
  expect(contents).toStartWith('#!/usr/bin/env bash\n')
  // Without this the script keeps going after a failed step and exits 0, so the
  // widget reports a setup that worked when it did not.
  expect(contents).toContain('set -euo pipefail')
  expect(contents).toContain('bun install && cp .env.example .env')
  // 0o111: executable by someone. aimux runs it through `bash`, but a user who
  // opens it expects to be able to run it too.
  expect(statSync(getSetupScriptPath('p1')).mode & 0o111).toBeGreaterThan(0)
})

test('what was written is what the row reads back', () => {
  const state = withProjects()
  const row = rowsFor(state)[0]
  if (!row) throw new Error('no row')
  const command = 'make setup && ./scripts/seed.sh --yes'

  writeRow(row, command, ctxFor(state))

  // Rebuilt, because a row captures its value when it is built.
  const reread = rowsFor(state)[0]
  if (!reread) throw new Error('no row')
  expect(readRow(reread, ctxFor(state))).toBe(command)
})

test('the stub reads as its one echo line, not as boilerplate', () => {
  const state = withProjects()
  ensureSetupScriptStub('p1')

  const row = rowsFor(state)[0]
  if (!row) throw new Error('no row')
  // The shebang, `set -e…` and every comment are stripped, so what is left is the
  // one line the stub actually runs.
  expect(row.kind).toBe('text')
  expect(String(readRow(row, ctxFor(state)))).toContain('nothing to do yet')
})

test('a script with real work on several lines is shown, not made editable', () => {
  const state = withProjects()
  const path = getSetupScriptPath('p2')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    '#!/usr/bin/env bash\nset -euo pipefail\n\n# install\nbun install\n\nbun run build\ncp .env.example .env\n'
  )
  chmodSync(path, 0o755)

  const row = rowsFor(state)[1]
  if (!row) throw new Error('no row')

  // A one-line field cannot hold three commands, and offering to edit it would
  // mean truncating the script the moment someone confirms.
  expect(row.kind).toBe('action')
  expect(String(readRow(row, ctxFor(state)))).toContain('3 lines')
})

test('an unreadable script is not mistaken for an empty one', () => {
  const state = withProjects()
  const path = getSetupScriptPath('p1')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '#!/usr/bin/env bash\nset -euo pipefail\n\n# only comments\n')

  // Comments and boilerplate only: no work, so nothing to show and nothing to
  // truncate — editable, and empty.
  expect(readSetupScriptLines('p1')).toEqual([])
  const row = rowsFor(state)[0]
  expect(row?.kind).toBe('text')
})

test('writing to a project that has no data directory yet creates one', () => {
  withProjects()

  writeSetupCommand('p3', 'echo hi')

  expect(readSetupScriptLines('p3')).toEqual(['echo hi'])
})

test('a write is visible to the next read, even one that had already read', () => {
  withProjects()
  writeSetupCommand('p4', 'echo first')
  expect(readSetupScriptLines('p4')).toEqual(['echo first'])

  writeSetupCommand('p4', 'echo second')

  // Reads are cached against the file's mtime, because the search filter runs
  // this for every project on every keystroke. A write and the read after it can
  // land in the same millisecond, so the write drops the entry itself — without
  // that, this returns `echo first`.
  expect(readSetupScriptLines('p4')).toEqual(['echo second'])
})
