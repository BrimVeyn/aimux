import { expect, test } from 'bun:test'

import type { ProjectRecord } from '../../src/state/types'

import { filterSettingRows } from '../../src/settings/search'
import { appReducer, createInitialState } from '../../src/state/store'

const NOW = '2026-08-01T00:00:00.000Z'
const PROJECTS: ProjectRecord[] = [
  { createdAt: NOW, id: 'p1', lastOpenedAt: NOW, name: 'one', updatedAt: NOW },
]

function ids(query: string | null): string[] {
  return filterSettingRows(PROJECTS, query).map((hit) => hit.row.id)
}

test('an empty query is every setting there is', () => {
  expect(ids('').length).toBeGreaterThan(30)
  expect(ids(null)).toEqual(ids(''))
})

test('a label matches', () => {
  expect(ids('auto-commit')).toContain('autoCommit.enabled')
})

test('a description matches, so you can search for what a setting does', () => {
  // "quota" appears in no label — only in what the AI usage row says it does.
  expect(ids('quota')).toEqual(['statusBar.aiUsage.pollSeconds'])
})

test('an id matches, so a key seen in aimux.json can be found', () => {
  expect(ids('prefetchRadius')).toEqual(['git.prefetchRadius'])
})

test('a section name matches, so a whole section can be listed', () => {
  const hits = filterSettingRows(PROJECTS, 'experimental')

  expect(hits.length).toBeGreaterThan(1)
  expect(new Set(hits.map((hit) => hit.sectionId))).toEqual(new Set(['experimental']))
})

test('the case does not matter', () => {
  expect(ids('AUTOCOMMIT.ENABLED')).toContain('autoCommit.enabled')
})

test('nothing matches nothing', () => {
  expect(ids('zzzznope')).toEqual([])
})

test('a hit knows where it lives, in the screen own numbering', () => {
  const hit = filterSettingRows(PROJECTS, 'prefetchRadius')[0]
  if (!hit) throw new Error('expected a hit')

  expect(hit.sectionId).toBe('git')
  // The index counts every row of every section, because that is what the
  // cursor holds — so jumping to a result is the index it already carries.
  const state = { ...createInitialState(), projects: PROJECTS }
  const jumped = appReducer(appReducer(state, { type: 'enter-settings' }), {
    rowIndex: hit.rowIndex,
    type: 'settings-select-row',
  })
  expect(jumped.settings.rowIndex).toBe(hit.rowIndex)
  expect(filterSettingRows(PROJECTS, null)[jumped.settings.rowIndex]?.row.id).toBe(
    'git.prefetchRadius'
  )
})

test('rows built from the projects are searchable too', () => {
  const hits = filterSettingRows(PROJECTS, 'one')

  expect(hits.map((hit) => hit.row.id)).toContain('setup.script.p1')
})

test('the mouse can move the selection through the results', () => {
  const state = { ...createInitialState(), projects: PROJECTS }
  const searching = appReducer(appReducer(state, { type: 'enter-settings' }), {
    type: 'open-settings-search',
  })

  // What hovering a row dispatches. `set-modal-selection-index` used to consult a
  // hand-kept list of modal types that this one was not on, so every result in
  // this picker was unhoverable — and the click that follows acts on the
  // selection, so the mouse did nothing at all here.
  const hovered = appReducer(searching, { index: 3, type: 'set-modal-selection-index' })

  expect(hovered.modal.selectedIndex).toBe(3)
})
