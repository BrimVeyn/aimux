import { afterEach, describe, expect, setSystemTime, test } from 'bun:test'

import {
  recordMultiClickClipboardWrite,
  shouldSuppressSelectionCopy,
} from '../../src/app-runtime/multi-click-clipboard-guard'

afterEach(() => {
  setSystemTime()
})

describe('multi-click clipboard guard', () => {
  test('suppresses exactly one selection copy after a multi-click write', () => {
    recordMultiClickClipboardWrite()

    // finishSelection() fires exactly one 'selection' event — suppress it once.
    expect(shouldSuppressSelectionCopy()).toBe(true)
    // The arm is consumed: a later, unrelated selection is not swallowed.
    expect(shouldSuppressSelectionCopy()).toBe(false)
  })

  test('does not suppress when no multi-click write was recorded', () => {
    // Consume any arm left over from a previous test first.
    shouldSuppressSelectionCopy()

    expect(shouldSuppressSelectionCopy()).toBe(false)
  })

  test('self-heals: a stale arm past the window is consumed without suppressing', () => {
    setSystemTime(new Date(10_000))
    recordMultiClickClipboardWrite()

    // The expected finishSelection event never arrived; time moves past the
    // guard window. The stale arm must not swallow the next genuine selection.
    setSystemTime(new Date(10_000 + 300))
    expect(shouldSuppressSelectionCopy()).toBe(false)
    expect(shouldSuppressSelectionCopy()).toBe(false)
  })
})
