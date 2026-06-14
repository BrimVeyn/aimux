import { afterEach, describe, expect, test } from 'bun:test'

import {
  resetSelectionClipboardDedup,
  shouldWriteSelectionToClipboard,
} from '../../src/app-runtime/selection-clipboard-dedup'

afterEach(() => {
  resetSelectionClipboardDedup()
})

describe('selection clipboard dedup', () => {
  test('first selection passes through', () => {
    expect(shouldWriteSelectionToClipboard('hello')).toBe(true)
  })

  test('repeat of the same selection is suppressed', () => {
    expect(shouldWriteSelectionToClipboard('hello')).toBe(true)
    expect(shouldWriteSelectionToClipboard('hello')).toBe(false)
    expect(shouldWriteSelectionToClipboard('hello')).toBe(false)
  })

  test('a different selection passes and becomes the new baseline', () => {
    expect(shouldWriteSelectionToClipboard('one')).toBe(true)
    expect(shouldWriteSelectionToClipboard('two')).toBe(true)
    expect(shouldWriteSelectionToClipboard('two')).toBe(false)
    expect(shouldWriteSelectionToClipboard('one')).toBe(true)
  })

  test('reset lets the same text be written again', () => {
    expect(shouldWriteSelectionToClipboard('again')).toBe(true)
    expect(shouldWriteSelectionToClipboard('again')).toBe(false)

    resetSelectionClipboardDedup()

    expect(shouldWriteSelectionToClipboard('again')).toBe(true)
  })

  test('empty string is treated as just another value (callers gate length)', () => {
    expect(shouldWriteSelectionToClipboard('')).toBe(true)
    expect(shouldWriteSelectionToClipboard('')).toBe(false)
    expect(shouldWriteSelectionToClipboard('x')).toBe(true)
  })
})
