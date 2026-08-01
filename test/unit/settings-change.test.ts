import { getStatusBarSeparator, type StatusBarSeparator } from '@brimveyn/aimux-config'
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { AppState } from '../../src/state/types'

import { changeSelectedSetting } from '../../src/app-runtime/settings-actions'
import { getConfigPath } from '../../src/config'
import { ALL_SETTING_ROWS, getSectionRows } from '../../src/settings/sections'
import { hydrateSettings, settingsStore } from '../../src/settings/settings-store'
import { appReducer, createInitialState } from '../../src/state/store'

const SEPARATOR_ID = 'statusBar.separator'
const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
const dirs: string[] = []

const STATE = createInitialState()
const SEPARATOR_ROW = getSectionRows('statusBar', STATE.projects).find(
  (row) => row.id === SEPARATOR_ID
)
const SEPARATOR_INDEX = getSectionRows('statusBar', STATE.projects).findIndex(
  (row) => row.id === SEPARATOR_ID
)
if (!SEPARATOR_ROW || SEPARATOR_ROW.kind !== 'select') {
  throw new Error('expected a select row for the status bar separator')
}
const OPTIONS = SEPARATOR_ROW.options.map((option) => option.value)

/** A state parked on the separator row, which is what the effect reads. */
function onSeparatorRow(pane: 'nav' | 'rows' = 'rows'): AppState {
  const home = mkdtempSync(join(tmpdir(), 'aimux-settings-change-'))
  dirs.push(home)
  process.env.HOME = home
  delete process.env.AIMUX_PROFILE
  mkdirSync(dirname(getConfigPath()), { recursive: true })
  hydrateSettings(ALL_SETTING_ROWS, {})

  const base = appReducer(createInitialState(), { type: 'enter-settings' })
  return {
    ...base,
    settings: { pane, rowIndex: SEPARATOR_INDEX, sectionId: 'statusBar' },
  }
}

function change(state: AppState, delta?: 1 | -1): void {
  changeSelectedSetting({ getState: () => state }, delta)
}

function stored(): unknown {
  return settingsStore.getState().values[SEPARATOR_ID]
}

afterEach(() => {
  process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  settingsStore.setState({ fromConfigFile: new Set(), values: {} })
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

test('activating a select advances it and applies it live', () => {
  const state = onSeparatorRow()
  expect(stored()).toBe(OPTIONS[0])

  change(state)

  expect(stored()).toBe(OPTIONS[1])
  // Applied, not just stored: the status bar reads this singleton every render.
  expect(getStatusBarSeparator()).toBe(OPTIONS[1] as StatusBarSeparator)
})

test('a select wraps round rather than stopping on the last option', () => {
  const state = onSeparatorRow()

  for (let i = 0; i < OPTIONS.length; i++) change(state)

  expect(stored()).toBe(OPTIONS[0])
})

test('minus walks the options backwards', () => {
  const state = onSeparatorRow()

  change(state, -1)

  expect(stored()).toBe(OPTIONS.at(-1))
})

test('nothing changes while the focus is on the section list', () => {
  const state = onSeparatorRow('nav')

  change(state)

  expect(stored()).toBe(OPTIONS[0])
})

test('an info row is not a setting and is left alone', () => {
  const rows = getSectionRows('about', STATE.projects)
  const state = {
    ...onSeparatorRow(),
    settings: { pane: 'rows' as const, rowIndex: 0, sectionId: 'about' },
  }
  expect(rows[0]?.kind).toBe('info')

  change(state)

  expect(stored()).toBe(OPTIONS[0])
})
