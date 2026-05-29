import { describe, expect, test } from 'bun:test'

import {
  recordMultiClickClipboardWrite,
  shouldSuppressSelectionCopy,
} from '../../src/app-runtime/multi-click-clipboard-guard'

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
})
