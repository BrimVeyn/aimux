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
  expect(menu.map(([label]) => label)).toEqual(['Move to right bar', 'Move down', 'Hide'])
})

test('last widget offers move-up instead of move-down', () => {
  const menu = buildWidgetContextMenu(bars(), 'left', 'git')
  expect(menu.map(([label]) => label)).toEqual(['Move to right bar', 'Move up', 'Hide'])
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
  expect(menu.map(([label]) => label)).toEqual(['Move to right bar'])
})

test('the bar menu offers a way back for each hidden widget', () => {
  const withHidden = bars({
    left: {
      visible: true,
      widgets: [
        { grow: 50, id: 'projects', visible: true },
        { grow: 50, id: 'git', visible: false },
      ],
      width: 28,
    },
  })
  const menu = buildBarContextMenu(withHidden, 'left')
  expect(menu.map(([label]) => label)).toEqual(['Hide left bar', 'Show Git'])

  const actions = capture(() => menu[1]?.[1]())
  expect(actions).toEqual([{ type: 'toggle-widget', widgetId: 'git' }])
})
