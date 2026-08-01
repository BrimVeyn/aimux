import { describe, expect, test } from 'bun:test'

import { truncate, truncateStart } from '../../src/ui/truncate'

describe('truncate', () => {
  test('leaves a label that fits alone', () => {
    expect(truncate('main', 10)).toBe('main')
    expect(truncateStart('main', 10)).toBe('main')
  })

  test('never exceeds the budget', () => {
    expect(truncate('nathan/feat/dictation-fix', 12).length).toBe(12)
    expect(truncateStart('nathan/feat/dictation-fix', 12).length).toBe(12)
  })

  test('cuts the end, or the front when the end is the meaning', () => {
    // The one on the left names the author twice and the work not at all.
    expect(truncate('nathan/feat/dictation-fix', 12)).toBe('nathan/feat…')
    expect(truncateStart('nathan/feat/dictation-fix', 12)).toBe('…ctation-fix')
  })

  test('degenerate budgets', () => {
    expect(truncateStart('main', 0)).toBe('')
    expect(truncateStart('main', 1)).toBe('…')
  })
})
