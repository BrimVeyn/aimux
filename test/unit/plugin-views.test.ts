import { afterEach, describe, expect, test } from 'bun:test'

import { clearHelpModeLabels, helpModeLabels } from '../../src/input/keymap/help-entries'
import { clearModeDerivations, deriveModeId } from '../../src/input/modes/bridge'
import {
  clearPluginModes,
  isValidTransition,
  registeredPluginModes,
} from '../../src/input/modes/transitions'
import { appReducer, createInitialState } from '../../src/state/store'
import {
  clearPluginViews,
  getPluginView,
  listPluginViews,
  onPluginViewsChanged,
  registerPluginView,
} from '../../src/ui/plugin-views'

/**
 * A plugin view is four registrations that only work together: a renderer, a
 * keyboard mode, the transitions that let input reach it, and a help heading.
 * Registering them separately would be four chances to forget one, so
 * `registerPluginView` does all four and its disposer undoes all four.
 */

const VIEW = {
  id: 'acme.thing.board',
  pluginId: 'acme.thing',
  render: () => null,
  title: 'Acme board',
}

afterEach(() => {
  clearPluginViews()
  clearPluginModes()
  clearModeDerivations()
  clearHelpModeLabels()
})

describe('plugin views', () => {
  test('registering wires the renderer, the mode, the transitions and the heading', () => {
    registerPluginView(VIEW)

    expect(getPluginView('acme.thing.board')?.title).toBe('Acme board')
    expect(registeredPluginModes()).toEqual(['plugin.acme.thing.board'])
    expect(isValidTransition('navigation', 'plugin.acme.thing.board')).toBe(true)
    expect(helpModeLabels().at(-1)).toEqual({
      label: 'Acme board',
      modeId: 'plugin.acme.thing.board',
    })
  })

  test('the disposer unwinds all four', () => {
    const dispose = registerPluginView(VIEW)
    const headings = helpModeLabels().length
    dispose()

    expect(getPluginView('acme.thing.board')).toBeUndefined()
    expect(registeredPluginModes()).toEqual([])
    expect(isValidTransition('navigation', 'plugin.acme.thing.board')).toBe(false)
    expect(helpModeLabels()).toHaveLength(headings - 1)
  })

  test('input routes to the view mode exactly while that view is open', () => {
    registerPluginView(VIEW)
    let state = createInitialState()
    expect(deriveModeId(state)).toBe('navigation')

    state = appReducer(state, { type: 'open-plugin-view', viewId: 'acme.thing.board' })
    expect(state.focusMode).toBe('plugin-view')
    expect(state.activePluginView).toBe('acme.thing.board')
    expect(deriveModeId(state)).toBe('plugin.acme.thing.board')

    state = appReducer(state, { type: 'close-plugin-view' })
    expect(state.focusMode).toBe('navigation')
    expect(state.activePluginView).toBeNull()
    expect(deriveModeId(state)).toBe('navigation')
  })

  test('a second view does not claim the first view s input', () => {
    registerPluginView(VIEW)
    registerPluginView({ ...VIEW, id: 'acme.thing.other', title: 'Other' })

    let state = createInitialState()
    state = appReducer(state, { type: 'open-plugin-view', viewId: 'acme.thing.other' })
    expect(deriveModeId(state)).toBe('plugin.acme.thing.other')
  })

  test('an explicit modeId is honoured', () => {
    registerPluginView({ ...VIEW, modeId: 'plugin.acme.custom' })
    let state = createInitialState()
    state = appReducer(state, { type: 'open-plugin-view', viewId: 'acme.thing.board' })
    expect(deriveModeId(state)).toBe('plugin.acme.custom')
  })

  test('closing a view that is not open leaves the state alone', () => {
    const state = createInitialState()
    expect(appReducer(state, { type: 'close-plugin-view' })).toBe(state)
  })

  test('subscribers are notified on register and dispose', () => {
    let notifications = 0
    const unsubscribe = onPluginViewsChanged(() => {
      notifications += 1
    })

    const dispose = registerPluginView(VIEW)
    expect(notifications).toBe(1)
    dispose()
    expect(notifications).toBe(2)

    unsubscribe()
    registerPluginView(VIEW)
    expect(notifications).toBe(2)
  })

  test('listing reports every registered view', () => {
    registerPluginView(VIEW)
    registerPluginView({ ...VIEW, id: 'acme.thing.other', title: 'Other' })
    expect(
      listPluginViews()
        .map((view) => view.id)
        .sort()
    ).toEqual(['acme.thing.board', 'acme.thing.other'])
  })
})
