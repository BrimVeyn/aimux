import { afterEach, describe, expect, test } from 'bun:test'

import {
  BUILTIN_STATS_PAGES,
  clearStatsPages,
  getStatsPageRenderer,
  registerStatsPage,
  registerStatsPageRenderer,
  statsPageAt,
  statsPages,
} from '../../src/state/stats-pages'
import { appReducer, createInitialState } from '../../src/state/store'

/**
 * The page list is a bound: the reducer clamps the stats cursor with it. A
 * bound read once at import stops being true the moment a plugin loads, which
 * is why `statsPages()` is a call.
 */

const PAGE = { glyph: '\u{25C6}', id: 'acme.thing.board', label: 'Board' }

afterEach(() => {
  clearStatsPages()
})

describe('plugin stats pages', () => {
  test('a registered page lands after the built-ins', () => {
    registerStatsPage(PAGE)
    const ids = statsPages().map((page) => page.id)
    // The page a user reaches by muscle memory keeps its index.
    expect(ids.slice(0, BUILTIN_STATS_PAGES.length)).toEqual(
      BUILTIN_STATS_PAGES.map((page) => page.id)
    )
    expect(ids.at(-1)).toBe('acme.thing.board')
  })

  test('with nothing registered the list is the built-in array itself', () => {
    expect(statsPages()).toBe(BUILTIN_STATS_PAGES)
  })

  test('the reducer clamps against the live list, not a snapshot', () => {
    let state = createInitialState()
    // Past the end of the built-ins: clamped to the last one.
    state = appReducer(state, { pageIndex: 99, type: 'stats-select-page' })
    expect(state.stats.pageIndex).toBe(BUILTIN_STATS_PAGES.length - 1)

    registerStatsPage(PAGE)
    state = appReducer(state, { pageIndex: 99, type: 'stats-select-page' })
    expect(state.stats.pageIndex).toBe(BUILTIN_STATS_PAGES.length)
    expect(statsPageAt(state.stats.pageIndex).label).toBe('Board')
  })

  test('a page disappearing moves the cursor rather than stranding it', () => {
    const dispose = registerStatsPage(PAGE)
    let state = createInitialState()
    state = appReducer(state, { pageIndex: BUILTIN_STATS_PAGES.length, type: 'stats-select-page' })
    expect(statsPageAt(state.stats.pageIndex).id).toBe('acme.thing.board')

    dispose()
    // The stored index is now past the end; the next navigation clamps it.
    state = appReducer(state, { delta: 1, type: 'stats-move-page' })
    expect(state.stats.pageIndex).toBe(BUILTIN_STATS_PAGES.length - 1)
  })

  test('the renderer is looked up by page id and disposes with it', () => {
    const dispose = registerStatsPageRenderer('acme.thing.board', () => 'rendered')
    expect(getStatsPageRenderer('acme.thing.board')?.()).toBe('rendered')
    dispose()
    expect(getStatsPageRenderer('acme.thing.board')).toBeUndefined()
  })

  test('statsPageAt falls back rather than returning undefined', () => {
    // The view indexes with a stored cursor; an out-of-range one must still
    // render a page.
    expect(statsPageAt(99).id).toBe('usage')
    expect(statsPageAt(-1).id).toBe('usage')
  })
})
