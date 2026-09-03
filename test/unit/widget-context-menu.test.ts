import { expect, test } from 'bun:test'

import type { AppAction } from '../../src/state/actions'
import type { BarsState } from '../../src/state/types'

import { setActiveDispatch } from '../../src/state/dispatch-ref'
import {
  buildBarContextMenu,
  buildWidgetContextMenu,
} from '../../src/ui/widgets/widget-context-menu'

function bars(overrides: Partial<BarsState> = {}): BarsState {
  return {
    left: {
      visible: true,
      widgets: [
        { grow: 50, id: 'projects', visible: true },
        { grow: 50, id: 'git', visible: true },
      ],
      width: 28,
    },
    right: { visible: false, widgets: [], width: 40 },
    ...overrides,
  }
}

function capture(run: () => void): AppAction[] {
  const actions: AppAction[] = []
  setActiveDispatch((action) => actions.push(action))
  try {
    run()
  } finally {
    setActiveDispatch(null)
  }
  return actions
}

test('first widget of two offers move-across, move-down and hide', () => {
  const menu = buildWidgetContextMenu(bars(), 'left', 'projects')
  // `setup` ships unplaced, so it is offered as an addition — see the
  // add-widget tests at the bottom.
  expect(menu.map(([label]) => label)).toEqual([
    'Move to right bar',
    'Move down',
    'Hide',
    'Add Setup',
  ])
})

test('last widget offers move-up instead of move-down', () => {
  const menu = buildWidgetContextMenu(bars(), 'left', 'git')
  expect(menu.map(([label]) => label)).toEqual([
    'Move to right bar',
    'Move up',
    'Hide',
    'Add Setup',
  ])
})

test('move-across appends the widget to the other bar', () => {
  const menu = buildWidgetContextMenu(bars(), 'left', 'git')
  const actions = capture(() => menu[0]?.[1]())
  expect(actions).toEqual([{ index: 0, side: 'right', type: 'move-widget', widgetId: 'git' }])
})

test('move-down swaps with the next widget', () => {
  const menu = buildWidgetContextMenu(bars(), 'left', 'projects')
  const actions = capture(() => menu[1]?.[1]())
  expect(actions).toEqual([{ index: 1, side: 'left', type: 'move-widget', widgetId: 'projects' }])
})

test('the last visible widget cannot be hidden', () => {
  const single = bars({
    left: { visible: true, widgets: [{ grow: 100, id: 'projects', visible: true }], width: 28 },
  })
  const menu = buildWidgetContextMenu(single, 'left', 'projects')
  expect(menu.map(([label]) => label)).toEqual(['Move to right bar', 'Add Git', 'Add Setup'])
})

const withHidden = bars({
  left: {
    visible: true,
    widgets: [
      { grow: 50, id: 'projects', visible: true },
      { grow: 50, id: 'git', visible: false },
      { grow: 50, id: 'setup', visible: false },
    ],
    width: 28,
  },
})

test('the bar menu offers a way back for each hidden widget', () => {
  const menu = buildBarContextMenu(withHidden, 'left')
  expect(menu.map(([label]) => label)).toEqual(['Hide left bar', 'Show Git', 'Show Setup'])

  const actions = capture(() => menu[1]?.[1]())
  expect(actions).toEqual([{ type: 'toggle-widget', widgetId: 'git' }])
})

test('a widget menu also offers a way back for each hidden widget', () => {
  // The bar's own menu is unreachable — widget slots cover the whole body and
  // stop right-click propagation — so without these entries, hiding a widget is
  // a one-way door for a mouse user, and a widget that ships hidden (`setup`) is
  // undiscoverable.
  const menu = buildWidgetContextMenu(withHidden, 'left', 'projects')
  expect(menu.map(([label]) => label)).toEqual([
    'Move to right bar',
    'Move down',
    'Show Git',
    'Show Setup',
  ])

  const actions = capture(() => menu[3]?.[1]())
  expect(actions).toEqual([{ type: 'toggle-widget', widgetId: 'setup' }])
})

test('a hidden widget in the other bar is still offered', () => {
  const rightHidden = bars({
    right: { visible: false, widgets: [{ grow: 100, id: 'setup', visible: false }], width: 40 },
  })
  const menu = buildWidgetContextMenu(rightHidden, 'left', 'git')
  expect(menu.map(([label]) => label)).toContain('Show Setup')
})

/**
 * Adding a widget that is in neither bar. Until this existed, a widget nothing
 * had placed — every plugin's widget, on first load — could be registered,
 * renderable and listed, and still be impossible to put anywhere without
 * editing `aimux.json` by hand.
 */
test('a widget in neither bar is offered, and lands in the bar whose menu offered it', () => {
  const menu = buildBarContextMenu(bars(), 'right')
  expect(menu.map(([label]) => label)).toEqual(['Hide right bar', 'Add Setup'])

  const actions = capture(() => menu[1]?.[1]())
  expect(actions).toEqual([{ side: 'right', type: 'add-widget', widgetId: 'setup' }])
})

test('a widget already placed is never offered as an addition', () => {
  const menu = buildBarContextMenu(withHidden, 'left')
  expect(menu.map(([label]) => label).filter((label) => label.startsWith('Add '))).toEqual([])
})
