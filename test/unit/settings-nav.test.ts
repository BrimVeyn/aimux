import { expect, test } from 'bun:test'

import type { AppAction } from '../../src/state/actions'
import type { AppState } from '../../src/state/types'

import { getSectionRows, SETTING_SECTIONS } from '../../src/settings/sections'
import { appReducer, createInitialState } from '../../src/state/store'

function open(): AppState {
  return appReducer(createInitialState(), { type: 'enter-settings' })
}

function apply(state: AppState, ...actions: AppAction[]): AppState {
  let next = state
  for (const action of actions) next = appReducer(next, action)
  return next
}

const FIRST_SECTION = SETTING_SECTIONS[0]
const LAST_SECTION = SETTING_SECTIONS.at(-1)
if (!FIRST_SECTION || !LAST_SECTION) throw new Error('the settings screen has no sections')

const FIRST_ROW_COUNT = getSectionRows(FIRST_SECTION.id).length

test('opening lands in the section list, at the top of it', () => {
  const state = open()

  expect(state.focusMode).toBe('settings')
  expect(state.settings.pane).toBe('nav')
  expect(state.settings.rowIndex).toBe(0)
})

test('closing goes back to navigation', () => {
  expect(apply(open(), { type: 'exit-settings' }).focusMode).toBe('navigation')
})

test('l moves to the rows, h moves back', () => {
  const inRows = apply(open(), { pane: 'rows', type: 'settings-focus-pane' })
  expect(inRows.settings.pane).toBe('rows')

  const back = apply(inRows, { pane: 'nav', type: 'settings-focus-pane' })
  expect(back.settings.pane).toBe('nav')
})

test('j and k stop at the ends of the row list instead of wrapping', () => {
  const rowCount = FIRST_ROW_COUNT
  // Without this the loops below both start and end at 0 and prove nothing.
  expect(rowCount).toBeGreaterThan(1)

  let state = apply(open(), { pane: 'rows', type: 'settings-focus-pane' })
  for (let i = 0; i < rowCount + 5; i++) {
    state = appReducer(state, { delta: 1, type: 'settings-move-selection' })
  }
  expect(state.settings.rowIndex).toBe(rowCount - 1)

  for (let i = 0; i < rowCount + 5; i++) {
    state = appReducer(state, { delta: -1, type: 'settings-move-selection' })
  }
  expect(state.settings.rowIndex).toBe(0)
})

test('j and k stop at the ends of the section list too', () => {
  let state = open()
  for (let i = 0; i < SETTING_SECTIONS.length + 5; i++) {
    state = appReducer(state, { delta: 1, type: 'settings-move-selection' })
  }
  expect(state.settings.sectionId).toBe(LAST_SECTION.id)

  for (let i = 0; i < SETTING_SECTIONS.length + 5; i++) {
    state = appReducer(state, { delta: -1, type: 'settings-move-selection' })
  }
  expect(state.settings.sectionId).toBe(FIRST_SECTION.id)
})

test('changing section resets the row cursor', () => {
  const other = SETTING_SECTIONS[1]
  if (!other) throw new Error('this test needs a second section')

  const state = apply(
    open(),
    { pane: 'rows', type: 'settings-focus-pane' },
    { delta: 1, type: 'settings-move-selection' },
    { pane: 'nav', type: 'settings-focus-pane' },
    { sectionId: other.id, type: 'settings-select-section' }
  )

  // The row cursor pointed into the previous section's list; carrying it over
  // lands on an unrelated row, or past the end of a shorter section.
  expect(state.settings.sectionId).toBe(other.id)
  expect(state.settings.rowIndex).toBe(0)
})

test('j moves rows, not sections, once the focus is on the rows', () => {
  const state = apply(
    open(),
    { pane: 'rows', type: 'settings-focus-pane' },
    { delta: 1, type: 'settings-move-selection' }
  )

  expect(state.settings.rowIndex).toBe(1)
  expect(state.settings.sectionId).toBe(FIRST_SECTION.id)
})

test('clicking a row selects it and takes the focus with it', () => {
  const state = apply(open(), { rowIndex: 2, type: 'settings-select-row' })

  expect(state.settings.pane).toBe('rows')
  expect(state.settings.rowIndex).toBe(2)
})

test('clicking past the end of the list clamps instead of pointing at nothing', () => {
  const state = apply(open(), { rowIndex: FIRST_ROW_COUNT + 20, type: 'settings-select-row' })

  expect(state.settings.rowIndex).toBe(FIRST_ROW_COUNT - 1)
})
