import { afterEach, describe, expect, test } from 'bun:test'

import type { SideEffectContext } from '../../src/app-runtime/side-effect-context'

import {
  clearPluginEffects,
  registerPluginEffect,
  runPluginEffect,
} from '../../src/app-runtime/plugin-effects'
import { installUnhandledRejectionHandler } from '../../src/app-runtime/unhandled-rejections'
import { toastStore } from '../../src/state/toast-store'

/**
 * A promise nobody awaited used to be reported by Node, to stderr, which in
 * the UI process is the alternate screen: a stack trace painted over the
 * interface. It belongs in the debug log and a toast.
 */

const CTX = {} as SideEffectContext

const disposers: (() => void)[] = []

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
  clearPluginEffects()
  toastStore.setState({ toasts: [] })
})

describe('the UI process and its stray promises', () => {
  test('a rejection becomes a toast, not a stack trace', () => {
    disposers.push(installUnhandledRejectionHandler())

    process.emit('unhandledRejection', new Error('Remote backend destroyed'), Promise.resolve())

    const toasts = toastStore.getState().toasts
    expect(toasts.at(-1)?.message).toContain('Remote backend destroyed')
    expect(toasts.at(-1)?.variant).toBe('error')
  })

  test('the disposer puts the process back the way it was', () => {
    const before = process.listenerCount('unhandledRejection')
    const dispose = installUnhandledRejectionHandler()
    expect(process.listenerCount('unhandledRejection')).toBe(before + 1)
    dispose()
    expect(process.listenerCount('unhandledRejection')).toBe(before)
  })

  test('an effect that awaits its own work is contained by aimux', async () => {
    // What a plugin must do: the failure lands as a toast naming the plugin,
    // and never reaches the process at all.
    disposers.push(
      registerPluginEffect('acme.thing', 'load', async () => {
        await Promise.reject(new Error('Remote backend destroyed'))
      })
    )

    runPluginEffect('acme.thing', 'load', undefined, CTX)
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(toastStore.getState().toasts.at(-1)?.message).toBe(
      'plugin acme.thing.load: Remote backend destroyed'
    )
  })
})
