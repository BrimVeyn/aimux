import { afterEach, describe, expect, test } from 'bun:test'

import type { SideEffectContext } from '../../src/app-runtime/side-effect-context'

import {
  clearPluginEffects,
  pluginEffectIds,
  registerPluginEffect,
  runPluginEffect,
} from '../../src/app-runtime/plugin-effects'

/**
 * A plugin effect runs inside the same executor drain as the core ones, so the
 * property that matters is containment: a plugin that throws must not stop the
 * effects queued behind it for the same keystroke.
 */

// The registry never dereferences the context; it only hands it through.
const CTX = { state: { tabs: [] } } as unknown as SideEffectContext

afterEach(() => {
  clearPluginEffects()
})

describe('plugin effects', () => {
  test('routes to the handler registered for the id', () => {
    const seen: unknown[] = []
    registerPluginEffect('acme.a', 'notify', (payload) => {
      seen.push(payload)
    })

    runPluginEffect('acme.a', 'notify', { text: 'hi' }, CTX)
    expect(seen).toEqual([{ text: 'hi' }])
  })

  test('keeps handlers of different plugins apart', () => {
    const hits: string[] = []
    registerPluginEffect('acme.a', 'go', () => hits.push('a'))
    registerPluginEffect('acme.b', 'go', () => hits.push('b'))

    runPluginEffect('acme.b', 'go', undefined, CTX)
    expect(hits).toEqual(['b'])
  })

  test('a throwing handler is contained', () => {
    registerPluginEffect('acme.a', 'boom', () => {
      throw new Error('plugin blew up')
    })
    // Whatever else the executor has queued for this keystroke still runs.
    expect(() => runPluginEffect('acme.a', 'boom', undefined, CTX)).not.toThrow()
  })

  test('a rejecting async handler is contained too', async () => {
    registerPluginEffect('acme.a', 'boom', async () => {
      await Bun.sleep(1)
      throw new Error('later')
    })
    expect(() => runPluginEffect('acme.a', 'boom', undefined, CTX)).not.toThrow()
    await Bun.sleep(10)
  })

  test('an unhandled effect id does not throw', () => {
    // A keybinding can outlive the plugin that answered it.
    expect(() => runPluginEffect('acme.gone', 'anything', undefined, CTX)).not.toThrow()
  })

  test('disposing removes only that effect', () => {
    const dispose = registerPluginEffect('acme.a', 'one', () => {})
    registerPluginEffect('acme.a', 'two', () => {})
    expect(pluginEffectIds('acme.a').sort()).toEqual(['one', 'two'])

    dispose()
    expect(pluginEffectIds('acme.a')).toEqual(['two'])
  })

  test('re-registering replaces rather than stacking', () => {
    const hits: string[] = []
    registerPluginEffect('acme.a', 'go', () => hits.push('first'))
    registerPluginEffect('acme.a', 'go', () => hits.push('second'))

    runPluginEffect('acme.a', 'go', undefined, CTX)
    // A reload registers again; stacking would run both closures.
    expect(hits).toEqual(['second'])
  })

  test('a stale disposer does not remove the replacement', () => {
    const stale = registerPluginEffect('acme.a', 'go', () => {})
    registerPluginEffect('acme.a', 'go', () => {})
    stale()
    expect(pluginEffectIds('acme.a')).toEqual(['go'])
  })
})
