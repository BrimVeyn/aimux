import {
  clearPluginActions,
  hasPluginAction,
  KeymapBuilder,
  type KeyResult,
  type ModeContext,
  pluginAction,
  pluginActionNames,
  registerPluginAction,
  resolveConfig,
} from '@brimveyn/aimux-config'
import { afterEach, describe, expect, test } from 'bun:test'

import { createInitialState } from '../../src/state/store'

/**
 * A keymap is resolved at startup from `aimux.config.ts`; plugins load after
 * it. Binding a function would mean a config file could only reference plugins
 * it could import — the coupling a plugin system exists to remove — so a
 * keymap binds a *name* and the lookup happens on the keypress.
 */

const CTX: ModeContext = { state: createInitialState() }
const RESULT: KeyResult = {
  actions: [{ actionId: 'open', pluginId: 'acme.review', type: 'plugin-action' }],
  effects: [],
}

afterEach(() => {
  clearPluginActions()
})

describe('plugin keymap actions', () => {
  test('an unresolved name is inert, not an error', () => {
    // A disabled or failed plugin must not turn into a broken keyboard: the
    // key does nothing, the way an unbound key does.
    expect(pluginAction('acme.review.open')(CTX)).toBeNull()
    expect(hasPluginAction('acme.review.open')).toBe(false)
  })

  test('a registered name resolves on every call, not at bind time', () => {
    // Bound first, registered after — the real order at startup.
    const action = pluginAction('acme.review.open')
    expect(action(CTX)).toBeNull()

    registerPluginAction('acme.review.open', () => RESULT)
    expect(action(CTX)).toEqual(RESULT)
  })

  test('disposing makes the binding inert again', () => {
    const dispose = registerPluginAction('acme.review.open', () => RESULT)
    const action = pluginAction('acme.review.open')
    expect(action(CTX)).toEqual(RESULT)

    dispose()
    expect(action(CTX)).toBeNull()
    expect(pluginActionNames()).toEqual([])
  })

  test('a stale disposer does not remove the replacement', () => {
    const stale = registerPluginAction('acme.review.open', () => null)
    registerPluginAction('acme.review.open', () => RESULT)
    stale()
    // A reload registers again; the old fiber's disposer must not take the new
    // handler with it.
    expect(pluginAction('acme.review.open')(CTX)).toEqual(RESULT)
  })

  test('a handler returning null is passed through as "no binding here"', () => {
    registerPluginAction('acme.review.open', () => null)
    expect(pluginAction('acme.review.open')(CTX)).toBeNull()
  })

  test('the handler receives the mode context', () => {
    const seen: ModeContext[] = []
    registerPluginAction('acme.review.open', (ctx) => {
      seen.push(ctx)
      return RESULT
    })
    pluginAction('acme.review.open')(CTX)
    expect(seen).toEqual([CTX])
  })

  test('k.plugin binds a name through the keymap builder', () => {
    const config = resolveConfig({
      keymaps: (k) =>
        k.mode('navigation', (m) =>
          m.map('<leader>zz', k.plugin('acme.review.open'), 'Open review')
        ),
    })

    const binding = config.keymaps.modes
      .get('navigation')
      ?.bindings.find((entry) => entry.keys === '<leader>zz')
    expect(binding?.description).toBe('Open review')

    // The binding is the deferred lookup, and it resolves once the plugin
    // registers.
    const action = binding?.result
    expect(typeof action).toBe('function')
    if (typeof action !== 'function') return
    expect(action(CTX)).toBeNull()

    registerPluginAction('acme.review.open', () => RESULT)
    expect(action(CTX)).toEqual(RESULT)
  })

  test('a plugin mode can be bound the same way', () => {
    const config = resolveConfig({
      keymaps: (k) =>
        k.mode('plugin.acme.review', (m) => m.map('q', k.plugin('acme.review.close'))),
    })
    expect(config.keymaps.modes.get('plugin.acme.review')?.bindings.map((b) => b.keys)).toEqual([
      'q',
    ])
  })

  test('the builder is still chainable', () => {
    const builder = new KeymapBuilder()
    expect(
      builder
        .leader('<C-a>')
        .timeout(500)
        .mode('navigation', (m) => m)
    ).toBe(builder)
  })
})
