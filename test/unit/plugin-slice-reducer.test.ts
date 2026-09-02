import { afterEach, describe, expect, test } from 'bun:test'

import {
  clearPluginSlices,
  reducePluginSlices,
  registerPluginSlice,
} from '../../src/state/reducers/plugin-slices'
import { appReducer, createInitialState } from '../../src/state/store'

/**
 * The plugin slice is the one place a plugin may change `AppState`, and the
 * routing has to hold two lines at once: a plugin can only touch its own key,
 * and it can never intercept a core action.
 */

interface Counter {
  count: number
}

afterEach(() => {
  clearPluginSlices()
})

describe('plugin slices', () => {
  test('a fresh state starts with no slices and version zero', () => {
    const state = createInitialState()
    expect(state.plugins).toEqual({})
    expect(state.pluginRegistryVersion).toBe(0)
  })

  test('routes a plugin-action to the owning reducer only', () => {
    registerPluginSlice<Counter>('acme.a', (slice, action) => ({
      count: (slice?.count ?? 0) + (action.payload as number),
    }))
    registerPluginSlice<Counter>('acme.b', (slice) => ({ count: (slice?.count ?? 0) + 100 }))

    let state = createInitialState()
    state = appReducer(state, {
      actionId: 'add',
      payload: 5,
      pluginId: 'acme.a',
      type: 'plugin-action',
    })

    expect(state.plugins['acme.a']).toEqual({ count: 5 })
    expect(state.plugins['acme.b']).toBeUndefined()
  })

  test('an action for an unregistered plugin leaves the state alone', () => {
    const state = createInitialState()
    const next = appReducer(state, {
      actionId: 'whatever',
      pluginId: 'acme.missing',
      type: 'plugin-action',
    })
    expect(next).toBe(state)
  })

  test('a reducer returning its own slice is treated as "no change"', () => {
    registerPluginSlice<Counter>('acme.a', (slice) => slice ?? { count: 0 })
    let state = createInitialState()
    state = appReducer(state, { actionId: 'init', pluginId: 'acme.a', type: 'plugin-action' })
    const settled = state

    // Same reference back: propagating a new AppState would re-render the
    // whole tree for nothing.
    const next = appReducer(settled, {
      actionId: 'noop',
      pluginId: 'acme.a',
      type: 'plugin-action',
    })
    expect(next).toBe(settled)
  })

  test('set-plugin-slice replaces, and undefined drops the key entirely', () => {
    let state = createInitialState()
    state = appReducer(state, { pluginId: 'acme.a', slice: { count: 7 }, type: 'set-plugin-slice' })
    expect(state.plugins['acme.a']).toEqual({ count: 7 })

    state = appReducer(state, { pluginId: 'acme.a', slice: undefined, type: 'set-plugin-slice' })
    // A tombstone would keep showing up in `Object.keys(state.plugins)`.
    expect('acme.a' in state.plugins).toBe(false)
  })

  test('bump-plugin-registry increments the version React subscribes to', () => {
    let state = createInitialState()
    state = appReducer(state, { type: 'bump-plugin-registry' })
    state = appReducer(state, { type: 'bump-plugin-registry' })
    expect(state.pluginRegistryVersion).toBe(2)
  })

  test('unregistering stops the routing without touching stored state', () => {
    const dispose = registerPluginSlice<Counter>('acme.a', () => ({ count: 1 }))
    let state = createInitialState()
    state = appReducer(state, { actionId: 'set', pluginId: 'acme.a', type: 'plugin-action' })
    expect(state.plugins['acme.a']).toEqual({ count: 1 })

    dispose()
    const after = appReducer(state, { actionId: 'set', pluginId: 'acme.a', type: 'plugin-action' })
    expect(after).toBe(state)
    // The slice survives an unload; whoever unloads decides whether to drop it.
    expect(after.plugins['acme.a']).toEqual({ count: 1 })
  })

  test('re-registering replaces rather than stacking', () => {
    registerPluginSlice<Counter>('acme.a', (slice) => ({ count: (slice?.count ?? 0) + 1 }))
    registerPluginSlice<Counter>('acme.a', (slice) => ({ count: (slice?.count ?? 0) + 10 }))
    let state = createInitialState()
    state = appReducer(state, { actionId: 'inc', pluginId: 'acme.a', type: 'plugin-action' })
    // A reload registers again; stacking would apply both closures.
    expect(state.plugins['acme.a']).toEqual({ count: 10 })
  })

  test('declines every core action, so it can never shadow one', () => {
    registerPluginSlice('acme.a', () => ({ touched: true }))
    const state = createInitialState()
    expect(reducePluginSlices(state, { snippets: [], type: 'set-snippets' })).toBeNull()
    expect(reducePluginSlices(state, { type: 'close-modal' })).toBeNull()
  })
})
