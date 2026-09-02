import { describe, expect, test } from 'bun:test'

import type { AppState } from '../../src/state/types'

import { BUILTIN_STATS_PAGES } from '../../src/state/stats-pages'
import { appReducer, createInitialState } from '../../src/state/store'

/**
 * The stats screen's cursor.
 *
 * The offset is the part worth testing: the reducer deliberately has no upper
 * bound, because only the rendered page knows how tall it is. That makes the
 * round trip through `stats-scroll-settled` load-bearing — without it the offset
 * climbs for as long as the key is held, and the way back up is a dead zone the
 * same length.
 */

function open(): AppState {
  return appReducer(createInitialState({}, [], [], false), { type: 'enter-stats' })
}

function scroll(state: AppState, times: number, delta: number): AppState {
  let current = state
  for (let index = 0; index < times; index++) {
    current = appReducer(current, { delta, type: 'stats-scroll' })
  }
  return current
}

describe('stats reducer', () => {
  test('entering and leaving moves focus and nothing else', () => {
    const opened = open()
    expect(opened.focusMode).toBe('stats')
    expect(opened.stats.scrollTop).toBe(0)

    const closed = appReducer(opened, { type: 'exit-stats' })
    expect(closed.focusMode).toBe('navigation')
    // The page is remembered across a close/open within the session.
    expect(closed.stats.pageIndex).toBe(opened.stats.pageIndex)
  })

  test('entering while already there is a no-op, not a scroll reset', () => {
    const scrolled = scroll(open(), 3, 1)
    expect(appReducer(scrolled, { type: 'enter-stats' })).toBe(scrolled)
  })

  test('the page cursor stops at both ends of the nav', () => {
    const last = BUILTIN_STATS_PAGES.length - 1
    let state = open()
    for (let index = 0; index < 10; index++) {
      state = appReducer(state, { delta: 1, type: 'stats-move-page' })
    }
    expect(state.stats.pageIndex).toBe(last)

    for (let index = 0; index < 10; index++) {
      state = appReducer(state, { delta: -1, type: 'stats-move-page' })
    }
    expect(state.stats.pageIndex).toBe(0)
  })

  test('selecting a page out of range clamps instead of blanking the screen', () => {
    const state = appReducer(open(), { pageIndex: 99, type: 'stats-select-page' })
    expect(state.stats.pageIndex).toBe(BUILTIN_STATS_PAGES.length - 1)
  })

  test('changing page drops the offset — a new page is a different length', () => {
    const scrolled = scroll(open(), 5, 1)
    expect(scrolled.stats.scrollTop).toBe(5)
    expect(appReducer(scrolled, { delta: 1, type: 'stats-move-page' }).stats.scrollTop).toBe(0)
  })

  test('scrolling never goes above the top', () => {
    expect(scroll(open(), 4, -1).stats.scrollTop).toBe(0)
    expect(appReducer(open(), { delta: -50, type: 'stats-scroll' }).stats.scrollTop).toBe(0)
  })

  test('the offset the box accepted is what the state keeps', () => {
    // Ten page-downs on a page with thirty rows of slack: the reducer counts a
    // hundred, the box stops at thirty, and the state has to end up at thirty —
    // otherwise seventy presses of `k` do nothing at all.
    const overshot = scroll(open(), 10, 10)
    expect(overshot.stats.scrollTop).toBe(100)

    const settled = appReducer(overshot, { scrollTop: 30, type: 'stats-scroll-settled' })
    expect(settled.stats.scrollTop).toBe(30)
    expect(appReducer(settled, { delta: -1, type: 'stats-scroll' }).stats.scrollTop).toBe(29)
  })

  test('a settled offset that changes nothing keeps the same state object', () => {
    // The view sends this from an effect keyed on the offset; a new object every
    // time would re-run the effect and dispatch again forever.
    const state = scroll(open(), 3, 1)
    expect(appReducer(state, { scrollTop: 3, type: 'stats-scroll-settled' })).toBe(state)
  })

  test('a settled offset is floored at zero like every other', () => {
    expect(
      appReducer(open(), { scrollTop: -5, type: 'stats-scroll-settled' }).stats.scrollTop
    ).toBe(0)
  })
})
