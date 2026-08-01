import { expect, test } from 'bun:test'

import type { AppState } from '../../src/state/types'

import { BAR_MAX_WIDTH, BAR_MIN_WIDTH, getBarWidth, visibleWidgets } from '../../src/state/bars'
import { appReducer, createInitialState } from '../../src/state/store'

function seedState(): AppState {
  return createInitialState()
}

/**
 * Only the visible widgets: boundary and resize math operates on those alone, so
 * a hidden widget (`setup` ships hidden) keeping its grow untouched is the
 * expected behaviour, not something these assertions should restate.
 */
function grows(state: AppState, side: 'left' | 'right'): Record<string, number> {
  return Object.fromEntries(visibleWidgets(state.bars[side]).map((w) => [w.id, w.grow]))
}

test('default layout puts every widget in the left bar, right bar collapsed', () => {
  const s = seedState()
  expect(s.bars.left.widgets.map((w) => w.id)).toEqual(['projects', 'git', 'setup'])
  // `setup` is opt-in, so only two of the three show by default.
  expect(visibleWidgets(s.bars.left).map((w) => w.id)).toEqual(['projects', 'git'])
  expect(getBarWidth(s.bars.left)).toBe(28)
  expect(getBarWidth(s.bars.right)).toBe(0)
})

test('bar width clamps on both sides', () => {
  const s0 = seedState()
  const narrow = appReducer(s0, { side: 'left', type: 'set-bar-width', width: 1 })
  expect(narrow.bars.left.width).toBe(BAR_MIN_WIDTH)
  const wide = appReducer(s0, { side: 'left', type: 'set-bar-width', width: 999 })
  expect(wide.bars.left.width).toBe(BAR_MAX_WIDTH)
  const grown = appReducer(s0, { delta: 4, side: 'left', type: 'resize-bar' })
  expect(grown.bars.left.width).toBe(32)
})

test('toggle-bar hides the left bar, collapsing its width to zero', () => {
  const s1 = appReducer(seedState(), { side: 'left', type: 'toggle-bar' })
  expect(s1.bars.left.visible).toBe(false)
  expect(getBarWidth(s1.bars.left)).toBe(0)
})

test('move-widget across bars preserves grow and reveals the target bar', () => {
  const s0 = seedState()
  const gitGrow = grows(s0, 'left').git
  const s1 = appReducer(s0, { index: 0, side: 'right', type: 'move-widget', widgetId: 'git' })
  expect(s1.bars.left.widgets.map((w) => w.id)).toEqual(['projects', 'setup'])
  expect(s1.bars.right.widgets.map((w) => w.id)).toEqual(['git'])
  expect(grows(s1, 'right').git).toBe(gitGrow)
  expect(s1.bars.right.visible).toBe(true)
  expect(getBarWidth(s1.bars.right)).toBeGreaterThan(0)
})

test('emptying a bar collapses it to zero width', () => {
  const s0 = seedState()
  const s1 = appReducer(s0, { index: 0, side: 'right', type: 'move-widget', widgetId: 'git' })
  const s2 = appReducer(s1, {
    index: 1,
    side: 'right',
    type: 'move-widget',
    widgetId: 'projects',
  })
  // `setup` stays behind but is hidden, so the bar is empty as far as layout goes.
  expect(visibleWidgets(s2.bars.left)).toHaveLength(0)
  expect(getBarWidth(s2.bars.left)).toBe(0)
  expect(s2.bars.right.widgets.map((w) => w.id)).toEqual(['git', 'projects'])
})

test('move-widget within a bar reorders it', () => {
  const s1 = appReducer(seedState(), {
    index: 0,
    side: 'left',
    type: 'move-widget',
    widgetId: 'git',
  })
  expect(s1.bars.left.widgets.map((w) => w.id)).toEqual(['git', 'projects', 'setup'])
})

test('toggle-widget hides a widget, then re-showing it reveals a hidden bar', () => {
  const hidden = appReducer(seedState(), { type: 'toggle-widget', widgetId: 'git' })
  expect(visibleWidgets(hidden.bars.left).map((w) => w.id)).toEqual(['projects'])

  const barHidden = appReducer(hidden, { side: 'left', type: 'toggle-bar' })
  expect(getBarWidth(barHidden.bars.left)).toBe(0)

  const shown = appReducer(barHidden, { type: 'toggle-widget', widgetId: 'git' })
  expect(shown.bars.left.visible).toBe(true)
  expect(visibleWidgets(shown.bars.left)).toHaveLength(2)
})

test('set-bar-boundary moves only the pair and preserves total grow', () => {
  const s0 = seedState()
  const total = s0.bars.left.widgets.reduce((sum, w) => sum + w.grow, 0)
  const s1 = appReducer(s0, { index: 0, ratio: 0.7, side: 'left', type: 'set-bar-boundary' })
  expect(grows(s1, 'left')).toEqual({ git: 30, projects: 70 })
  expect(s1.bars.left.widgets.reduce((sum, w) => sum + w.grow, 0)).toBe(total)
})

test('set-bar-boundary clamps at the minimum share', () => {
  const s1 = appReducer(seedState(), {
    index: 0,
    ratio: 0.01,
    side: 'left',
    type: 'set-bar-boundary',
  })
  expect(grows(s1, 'left')).toEqual({ git: 90, projects: 10 })
})

test('resize-widget grows the first widget and shrinks the second', () => {
  const s1 = appReducer(seedState(), { delta: 0.1, type: 'resize-widget', widgetId: 'projects' })
  expect(grows(s1, 'left')).toEqual({ git: 40, projects: 60 })
})

test('resize-widget on the second widget flips the sign', () => {
  const s1 = appReducer(seedState(), { delta: 0.1, type: 'resize-widget', widgetId: 'git' })
  expect(grows(s1, 'left')).toEqual({ git: 60, projects: 40 })
})

test('a hidden widget is excluded from boundary math', () => {
  const hidden = appReducer(seedState(), { type: 'toggle-widget', widgetId: 'git' })
  // Only one visible widget left — there is no boundary to move.
  const s1 = appReducer(hidden, { index: 0, ratio: 0.7, side: 'left', type: 'set-bar-boundary' })
  expect(s1).toBe(hidden)
})
