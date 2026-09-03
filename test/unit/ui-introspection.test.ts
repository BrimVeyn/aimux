import {
  clearPluginActions,
  getDefaultKeymapConfig,
  registerPluginAction,
} from '@brimveyn/aimux-config'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { AppAction } from '../../src/state/actions'

import { setActiveKeymap } from '../../src/input/keymap/keymap-ref'
import { registerKeymapLayer } from '../../src/input/keymap/plugin-layer'
import { registerAllModes } from '../../src/input/modes/handlers'
import { appStore } from '../../src/state/app-store'
import { setActiveDispatch, setActiveSideEffectRunner } from '../../src/state/dispatch-ref'
import { createInitialState } from '../../src/state/store'
import { describeUiState, resolveKeymap, runPluginActionByName } from '../../src/ui/introspection'
import { registerBarWidget } from '../../src/ui/widgets/registry'

/**
 * The three answers `aimux ui state`, `aimux keymap resolve` and
 * `aimux action run` are built from.
 *
 * They exist so an agent can check its own work: whether the widget it placed
 * is on the screen and drawable, whether the key it asked for is really its
 * own, and what an action does — without a keyboard and without a human
 * looking at the terminal.
 */

const keymap = getDefaultKeymapConfig()
setActiveKeymap(keymap)
registerAllModes(keymap)

beforeEach(() => {
  appStore.setState({ ...createInitialState(), dispatch: appStore.getState().dispatch })
})

afterEach(() => {
  clearPluginActions()
  setActiveDispatch(null)
  setActiveSideEffectRunner(null)
})

describe('describeUiState', () => {
  test('reports each bar, and whether anything can draw what is in it', () => {
    appStore
      .getState()
      .dispatch({ side: 'right', type: 'add-widget', widgetId: 'acme.thing.board' })

    const before = describeUiState()
    const placed = before.bars.right.widgets[0]
    expect(placed?.id).toBe('acme.thing.board')
    // Placed, but nothing has registered a renderer: an orphan, and bars skip
    // those. This is exactly the state an agent needs to be able to see.
    expect(placed?.renderable).toBe(false)

    const off = registerBarWidget({
      id: 'acme.thing.board',
      label: 'Board',
      render: () => null,
    })
    const after = describeUiState().bars.right.widgets[0]
    expect(after?.renderable).toBe(true)
    expect(after?.label).toBe('Board')
    off()
  })

  test('a plugin placement is reported as the plugin’s until the user moves it', () => {
    const dispatch = appStore.getState().dispatch
    dispatch({ placedBy: 'plugin', side: 'left', type: 'add-widget', widgetId: 'acme.thing.board' })
    expect(
      describeUiState().bars.left.widgets.find((w) => w.id === 'acme.thing.board')?.placedBy
    ).toBe('plugin')

    dispatch({ index: 0, side: 'right', type: 'move-widget', widgetId: 'acme.thing.board' })
    expect(
      describeUiState().bars.right.widgets.find((w) => w.id === 'acme.thing.board')?.placedBy
    ).toBeUndefined()
  })
})

describe('resolveKeymap', () => {
  test('names the origin, which is what tells a refusal from a binding', () => {
    // The shipped keymap owns `j`.
    const own = resolveKeymap('j', 'navigation')
    expect(own.bound).toBe(true)
    expect(own.origin).toBe('config')

    const layer = registerKeymapLayer('acme.thing', [
      { action: 'acme.thing.up', keys: '<leader>*', mode: 'navigation' },
      // Refused: the user's config already has this one.
      { action: 'acme.thing.down', keys: 'j', mode: 'navigation' },
    ])

    const mine = resolveKeymap('<leader>*', 'navigation')
    expect(mine.bound).toBe(true)
    expect(mine.origin).toBe('plugin')
    expect(mine.pluginId).toBe('acme.thing')

    // The refused one still reads as the user's, not the plugin's.
    expect(resolveKeymap('j', 'navigation').origin).toBe('config')
    layer.dispose()

    expect(resolveKeymap('<leader>*', 'navigation').bound).toBe(false)
  })

  test('an unbound key and an unknown mode are answers, not errors', () => {
    expect(resolveKeymap('<leader>~', 'navigation')).toMatchObject({ bound: false })
    expect(resolveKeymap('q', 'nope.not.a.mode')).toMatchObject({
      bound: false,
      reason: 'no handler for this mode',
    })
  })
})

describe('runPluginActionByName', () => {
  test('runs the action through the same channels a key press uses', () => {
    const actions: AppAction[] = []
    const effects: unknown[] = []
    setActiveDispatch((action) => actions.push(action))
    setActiveSideEffectRunner((effect) => effects.push(effect))

    registerPluginAction('acme.thing.open', () => ({
      actions: [{ side: 'left', type: 'toggle-bar' }],
      effects: [{ effectId: 'engage', payload: 3, pluginId: 'acme.thing', type: 'plugin-effect' }],
    }))

    expect(runPluginActionByName('acme.thing.open')).toMatchObject({
      actions: 1,
      effects: 1,
      ran: true,
    })
    expect(actions).toEqual([{ side: 'left', type: 'toggle-bar' }])
    expect(effects).toHaveLength(1)
  })

  test('an action nobody registered says so instead of pretending', () => {
    const report = runPluginActionByName('acme.thing.nope')
    expect(report.ran).toBe(false)
    expect(report.reason).toContain('no plugin has registered')
  })
})
