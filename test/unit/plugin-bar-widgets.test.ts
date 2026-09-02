import { afterEach, describe, expect, test } from 'bun:test'

import {
  clearPluginWidgetIds,
  getBarWidth,
  getKnownWidgetIds,
  isWidgetRenderable,
  visibleWidgets,
} from '../../src/state/bars'
import { createInitialState, DEFAULT_BARS } from '../../src/state/store'
import { clearBarWidgets, getWidgetLabel, registerBarWidget } from '../../src/ui/widgets/registry'

/**
 * The case that drove this: a persisted bar layout naming a widget whose
 * plugin is currently disabled. That id used to be pruned as corruption, and
 * the pruned layout written straight back to `aimux.json` — so re-enabling the
 * plugin put the widget somewhere else, or nowhere.
 */

const WIDGET = {
  id: 'acme.thing.board',
  label: 'Acme board',
  render: () => null,
}

afterEach(() => {
  clearBarWidgets()
  clearPluginWidgetIds()
})

describe('plugin bar widgets', () => {
  test('registering makes the id known and renderable', () => {
    expect(isWidgetRenderable('acme.thing.board')).toBe(false)
    registerBarWidget(WIDGET)
    expect(isWidgetRenderable('acme.thing.board')).toBe(true)
    expect(getKnownWidgetIds()).toContain('acme.thing.board')
    expect(getWidgetLabel('acme.thing.board')).toBe('Acme board')
  })

  test('the disposer removes the renderer and the id together', () => {
    const dispose = registerBarWidget(WIDGET)
    dispose()
    // Leaving one behind would mean either a bar reserving space for something
    // it cannot draw, or a widget nothing will place.
    expect(isWidgetRenderable('acme.thing.board')).toBe(false)
    expect(getKnownWidgetIds()).not.toContain('acme.thing.board')
  })

  test('an unknown label falls back to the id rather than blank', () => {
    expect(getWidgetLabel('acme.thing.gone')).toBe('acme.thing.gone')
  })

  test('a persisted plugin widget survives its plugin being disabled', () => {
    const bars = {
      ...DEFAULT_BARS,
      left: {
        ...DEFAULT_BARS.left,
        widgets: [
          { grow: 50, id: 'projects', visible: true },
          { grow: 50, id: 'acme.thing.board', visible: true },
        ],
      },
    }
    const state = createInitialState({}, [], [], false, { bars })

    // Kept in the layout — the placement is the user's, not corruption.
    expect(state.bars.left.widgets.map((widget) => widget.id)).toContain('acme.thing.board')
    // But not drawn while nothing can draw it.
    expect(visibleWidgets(state.bars.left).map((widget) => widget.id)).not.toContain(
      'acme.thing.board'
    )

    registerBarWidget(WIDGET)
    expect(visibleWidgets(state.bars.left).map((widget) => widget.id)).toContain('acme.thing.board')
  })

  test('a bar holding only orphans takes no columns', () => {
    const bar = {
      visible: true,
      widgets: [{ grow: 50, id: 'acme.thing.gone', visible: true }],
      width: 30,
    }
    // The bar width and the pane geometry read the same predicate, so an
    // orphan cannot leave a gap where a widget used to be.
    expect(getBarWidth(bar)).toBe(0)
    registerBarWidget({ ...WIDGET, id: 'acme.thing.gone' })
    expect(getBarWidth(bar)).toBe(30)
  })

  test('the built-in ids are always renderable', () => {
    for (const id of ['projects', 'git', 'setup']) {
      expect(isWidgetRenderable(id)).toBe(true)
    }
  })
})
