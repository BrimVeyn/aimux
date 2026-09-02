import { expect, test } from 'bun:test'

import type { AppAction } from '../../src/state/actions'
import type { AppState } from '../../src/state/types'

import { filterSettingRows } from '../../src/settings/search'
import { BUILTIN_SETTING_SECTIONS, totalRowCount } from '../../src/settings/sections'
import { appReducer, createInitialState } from '../../src/state/store'

function open(): AppState {
  return appReducer(createInitialState(), { type: 'enter-settings' })
}

function apply(state: AppState, ...actions: AppAction[]): AppState {
  let next = state
  for (const action of actions) next = appReducer(next, action)
  return next
}

const STATE = createInitialState()
const ROW_COUNT = totalRowCount(STATE.projects)
const SECOND_SECTION = BUILTIN_SETTING_SECTIONS[1]
if (!SECOND_SECTION) throw new Error('this test needs a second section')

function sectionAt(state: AppState): string | undefined {
  return filterSettingRows(state.projects, null)[state.settings.rowIndex]?.sectionId
}

test('opening lands at the top of the list', () => {
  const state = open()

  expect(state.focusMode).toBe('settings')
  expect(state.settings.rowIndex).toBe(0)
})

test('closing goes back to navigation', () => {
  expect(apply(open(), { type: 'exit-settings' }).focusMode).toBe('navigation')
})

test('j and k stop at the ends of the list instead of wrapping', () => {
  // Without this the loops below both start and end at 0 and prove nothing.
  expect(ROW_COUNT).toBeGreaterThan(1)

  let state = open()
  for (let i = 0; i < ROW_COUNT + 5; i++) {
    state = appReducer(state, { delta: 1, type: 'settings-move-selection' })
  }
  expect(state.settings.rowIndex).toBe(ROW_COUNT - 1)

  for (let i = 0; i < ROW_COUNT + 5; i++) {
    state = appReducer(state, { delta: -1, type: 'settings-move-selection' })
  }
  expect(state.settings.rowIndex).toBe(0)
})

test('j walks from one section into the next, because it is one list', () => {
  let state = open()
  const first = sectionAt(state)
  while (sectionAt(state) === first && state.settings.rowIndex < ROW_COUNT - 1) {
    state = appReducer(state, { delta: 1, type: 'settings-move-selection' })
  }

  expect(sectionAt(state)).toBe(SECOND_SECTION.id)
})

test('} jumps to the first row of the next section', () => {
  const state = apply(open(), { delta: 1, type: 'settings-jump-section' })

  expect(sectionAt(state)).toBe(SECOND_SECTION.id)
  // The first row of it, not the same offset carried across.
  expect(sectionAt(appReducer(state, { delta: -1, type: 'settings-move-selection' }))).toBe(
    BUILTIN_SETTING_SECTIONS[0]?.id
  )
})

test('{ from inside a section goes to its own first row before the one above', () => {
  const inSecond = apply(
    open(),
    { delta: 1, type: 'settings-jump-section' },
    { delta: 1, type: 'settings-move-selection' }
  )
  expect(sectionAt(inSecond)).toBe(SECOND_SECTION.id)

  const back = appReducer(inSecond, { delta: -1, type: 'settings-jump-section' })
  expect(sectionAt(back)).toBe(SECOND_SECTION.id)
  expect(back.settings.rowIndex).toBe(inSecond.settings.rowIndex - 1)
})

test('} at the last section stays put rather than falling off the end', () => {
  let state = open()
  for (let i = 0; i < BUILTIN_SETTING_SECTIONS.length + 5; i++) {
    state = appReducer(state, { delta: 1, type: 'settings-jump-section' })
  }

  expect(state.settings.rowIndex).toBeLessThan(ROW_COUNT)
  expect(sectionAt(state)).toBe(BUILTIN_SETTING_SECTIONS.at(-1)?.id)
})

test('clicking a row selects it', () => {
  expect(apply(open(), { rowIndex: 2, type: 'settings-select-row' }).settings.rowIndex).toBe(2)
})

test('the cursor is clamped by rows the projects add', () => {
  const NOW = '2026-08-01T00:00:00.000Z'
  const withProjects: AppState = {
    ...open(),
    projects: [
      { createdAt: NOW, id: 'p1', lastOpenedAt: NOW, name: 'one', updatedAt: NOW },
      { createdAt: NOW, id: 'p2', lastOpenedAt: NOW, name: 'two', updatedAt: NOW },
    ],
  }
  // Two projects, so Setup and Workspace each grow by two rows — and the count
  // came from `rowCount`, so nothing was built and no script was read for it.
  const expected = totalRowCount(withProjects.projects) - 1
  expect(expected).toBeGreaterThan(ROW_COUNT - 1)

  let state = withProjects
  for (let i = 0; i < expected + 5; i++) {
    state = appReducer(state, { delta: 1, type: 'settings-move-selection' })
  }

  expect(state.settings.rowIndex).toBe(expected)
})

test('clicking past the end of the list clamps instead of pointing at nothing', () => {
  const state = apply(open(), { rowIndex: ROW_COUNT + 20, type: 'settings-select-row' })

  expect(state.settings.rowIndex).toBe(ROW_COUNT - 1)
})
