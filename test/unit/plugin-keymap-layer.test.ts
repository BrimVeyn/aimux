import {
  clearPluginActions,
  getDefaultKeymapConfig,
  registerPluginAction,
} from '@brimveyn/aimux-config'
import { afterEach, expect, test } from 'bun:test'

import type { KeyInput, KeyResult, ModeContext } from '../../src/input/modes/types'

import { setActiveKeymap } from '../../src/input/keymap/keymap-ref'
import { registerKeymapLayer } from '../../src/input/keymap/plugin-layer'
import { registerAllModes } from '../../src/input/modes/handlers'
import { getHandler } from '../../src/input/modes/registry'
import { createInitialState } from '../../src/state/store'

/**
 * A plugin's own keybindings, layered over the keymap the user resolved at
 * startup. What this pins down is the whole reason the layer exists: a binding
 * that works without restarting aimux, comes back off on unload, and never
 * takes a key the user has already bound.
 */

const keymap = getDefaultKeymapConfig()
setActiveKeymap(keymap)
registerAllModes(keymap)

function key(name: string, opts: { ctrl?: boolean } = {}): KeyInput {
  return { ctrl: opts.ctrl ?? false, meta: false, name, sequence: name, shift: false }
}

function ctx(): ModeContext {
  return { state: createInitialState({}, [], [], false) }
}

function press(mode: string, input: KeyInput): KeyResult | null {
  const handler = getHandler(mode as Parameters<typeof getHandler>[0])
  if (!handler) throw new Error(`no handler for ${mode}`)
  return handler.handleKey(input, ctx())
}

/** The shipped leader is `<C-w>`; a sequence needs both presses. */
function pressLeaderThen(mode: string, name: string): KeyResult | null {
  press(mode, key('w', { ctrl: true }))
  return press(mode, key(name))
}

afterEach(() => {
  clearPluginActions()
})

test('a layered binding fires the plugin action, and unloading takes it back off', () => {
  const fired: string[] = []
  registerPluginAction('acme.thing.up', () => {
    fired.push('up')
    return { actions: [], effects: [] }
  })

  const layer = registerKeymapLayer('acme.thing', [
    { action: 'acme.thing.up', keys: '<leader>+', mode: 'navigation' },
  ])
  expect(layer.applied).toHaveLength(1)
  expect(layer.refused).toEqual([])

  expect(pressLeaderThen('navigation', '+')).not.toBeNull()
  expect(fired).toEqual(['up'])

  layer.dispose()
  // Back to "this key does nothing here": the sequence resolves to nothing.
  fired.length = 0
  pressLeaderThen('navigation', '+')
  expect(fired).toEqual([])
})

test('a key the user has already bound is refused, not stolen', () => {
  // `j` is bound in the shipped navigation keymap.
  const layer = registerKeymapLayer('acme.thing', [
    { action: 'acme.thing.up', keys: 'j', mode: 'navigation' },
  ])

  expect(layer.applied).toEqual([])
  expect(layer.refused).toEqual([
    { binding: { action: 'acme.thing.up', keys: 'j', mode: 'navigation' }, reason: 'taken' },
  ])

  // And the user's binding still does what it did.
  const result = press('navigation', key('j'))
  expect(result?.effects).toEqual([{ direction: 1, type: 'cycle-sidebar-item' }])
  layer.dispose()
})

test('a mode nobody has bound gets a handler — a plugin pane brings its own', () => {
  const fired: string[] = []
  registerPluginAction('acme.thing.close', () => {
    fired.push('close')
    return { actions: [], effects: [] }
  })
  const mode = 'plugin.pane.acme.thing.board'
  expect(getHandler(mode as Parameters<typeof getHandler>[0])).toBeUndefined()

  const layer = registerKeymapLayer('acme.thing', [{ action: 'acme.thing.close', keys: 'q', mode }])
  expect(layer.applied).toHaveLength(1)

  expect(press(mode, key('q'))).not.toBeNull()
  expect(fired).toEqual(['close'])
  layer.dispose()
})

test('an action nobody registered is bound, and simply does nothing', () => {
  // The plugin's UI half may register the verb after its bindings are applied,
  // and a plugin that failed to load should cost a key press, not a crash.
  const layer = registerKeymapLayer('acme.thing', [
    { action: 'acme.thing.missing', keys: '<leader>&', mode: 'navigation' },
  ])
  expect(layer.applied).toHaveLength(1)
  expect(() => pressLeaderThen('navigation', '&')).not.toThrow()
  layer.dispose()
})
