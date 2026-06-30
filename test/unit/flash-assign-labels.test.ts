import { describe, expect, test } from 'bun:test'

import { assignFlashLabels, type FlashTarget } from '../../src/ui/flash/assign-labels'

function targets(...names: string[]): FlashTarget[] {
  return names.map((name, i) => ({ key: `t${i}`, name }))
}

describe('assignFlashLabels', () => {
  test('returns empty for empty input', () => {
    expect(assignFlashLabels([])).toEqual([])
  })

  test('prefers each target first letter when free', () => {
    const result = assignFlashLabels(targets('alpha', 'bravo', 'charlie'))
    expect(result.map((r) => r.label)).toEqual(['a', 'b', 'c'])
  })

  test('falls back to pool when a first letter collides', () => {
    const result = assignFlashLabels(targets('alpha', 'apricot'))
    expect(result[0]?.label).toBe('a')
    expect(result[1]?.label).not.toBe('a')
    expect(result[1]?.label.length).toBe(1)
  })

  test('produces unique labels with no prefix/single collision', () => {
    const result = assignFlashLabels(
      targets(...Array.from({ length: 30 }, (_, i) => `target-${i}`))
    )
    const labels = result.map((r) => r.label)
    expect(new Set(labels).size).toBe(labels.length)
    const singles = labels.filter((l) => l.length === 1)
    for (const multi of labels.filter((l) => l.length > 1)) {
      const firstChar = multi[0]
      if (firstChar !== undefined) expect(singles).not.toContain(firstChar)
    }
  })

  test('uppercases and non-letters in name fall back to pool', () => {
    const result = assignFlashLabels(targets('  42!'))
    expect(result[0]?.label.length).toBe(1)
    expect(/[a-z]/.test(result[0]?.label ?? '')).toBe(true)
  })

  test('handles overflow beyond single-letter budget with 2-char labels', () => {
    const result = assignFlashLabels(targets(...Array.from({ length: 28 }, (_, i) => `n${i}`)))
    expect(result.length).toBe(28)
    const multi = result.filter((r) => r.label.length === 2)
    expect(multi.length).toBeGreaterThan(0)
  })
})
