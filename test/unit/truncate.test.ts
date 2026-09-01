import { describe, expect, test } from 'bun:test'

import { truncate } from '../../src/ui/truncate'

describe('truncate', () => {
  test('leaves a label that fits alone', () => {
    expect(truncate('main', 10)).toBe('main')
  })

  test('never exceeds the budget', () => {
    expect(truncate('nathan/feat/dictation-fix', 12).length).toBe(12)
  })

  test('cuts the end', () => {
    expect(truncate('nathan/feat/dictation-fix', 12)).toBe('nathan/feat…')
  })

  test('degenerate budgets', () => {
    expect(truncate('main', 0)).toBe('')
    expect(truncate('main', 1)).toBe('…')
  })
})
