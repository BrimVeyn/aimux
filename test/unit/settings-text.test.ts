import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { AppAction } from '../../src/state/actions'
import type { AppState } from '../../src/state/types'

import { changeSelectedSetting, commitSettingText } from '../../src/app-runtime/settings-actions'
import { getConfigPath } from '../../src/config'
import { ALL_SETTING_ROWS, getSectionRows } from '../../src/settings/sections'
import { hydrateSettings, settingsStore } from '../../src/settings/settings-store'
import { setActiveDispatch } from '../../src/state/dispatch-ref'
import { appReducer, createInitialState } from '../../src/state/store'

const TRIGGER_ID = 'snippets.triggerChar'
const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
const dirs: string[] = []

const ROW_INDEX = getSectionRows('commands').findIndex((row) => row.id === TRIGGER_ID)
if (ROW_INDEX === -1) throw new Error('expected a snippet trigger row in the commands section')

/** A state parked on the snippet trigger row, with a redirected config file. */
function onTriggerRow(): AppState {
  const home = mkdtempSync(join(tmpdir(), 'aimux-settings-text-'))
  dirs.push(home)
  process.env.HOME = home
  delete process.env.AIMUX_PROFILE
  mkdirSync(dirname(getConfigPath()), { recursive: true })
  hydrateSettings(ALL_SETTING_ROWS, {})

  const base = appReducer(createInitialState(), { type: 'enter-settings' })
  return { ...base, settings: { pane: 'rows', rowIndex: ROW_INDEX, sectionId: 'commands' } }
}

afterEach(() => {
  process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  setActiveDispatch(null)
  settingsStore.setState({ fromConfigFile: new Set(), values: {} })
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

test('activating a text row asks for a field, seeded with the current value', () => {
  const state = onTriggerRow()
  const dispatched: AppAction[] = []
  setActiveDispatch((action) => void dispatched.push(action))

  changeSelectedSetting({ getState: () => state })

  expect(dispatched).toEqual([
    {
      label: 'Snippet trigger',
      settingId: TRIGGER_ID,
      type: 'open-setting-text-modal',
      value: ':',
    },
  ])
})

test('minus and plus have nothing to do on a text row', () => {
  const state = onTriggerRow()
  const dispatched: AppAction[] = []
  setActiveDispatch((action) => void dispatched.push(action))

  changeSelectedSetting({ getState: () => state }, 1)
  changeSelectedSetting({ getState: () => state }, -1)

  expect(dispatched).toEqual([])
})

test('the field opens over the settings screen and hands the focus back on close', () => {
  const opened = appReducer(onTriggerRow(), {
    label: 'Snippet trigger',
    settingId: TRIGGER_ID,
    type: 'open-setting-text-modal',
    value: ':',
  })

  expect(opened.modal.type).toBe('setting-text')
  expect(opened.modal.editBuffer).toBe(':')
  // command-edit is what routes typing into the buffer; root.tsx keeps the
  // settings screen mounted for this modal type precisely because of it.
  expect(opened.focusMode).toBe('command-edit')

  const closed = appReducer(opened, { type: 'close-modal' })
  // Not 'navigation': the screen is still behind the field.
  expect(closed.focusMode).toBe('settings')
})

test('confirming writes the trimmed value', () => {
  const state = onTriggerRow()

  commitSettingText({ getState: () => state }, TRIGGER_ID, '  !  ')

  expect(settingsStore.getState().values[TRIGGER_ID]).toBe('!')
})

test('a value for a row that no longer exists is dropped', () => {
  const state = onTriggerRow()

  commitSettingText({ getState: () => state }, 'settings.gone', 'x')

  expect(settingsStore.getState().values['settings.gone']).toBeUndefined()
})
