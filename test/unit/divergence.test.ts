import { expect, test } from 'bun:test'

import { parseDivergenceCount, parseShortstat } from '../../src/git/divergence'
import { formatDiffCount, formatDiffStat } from '../../src/state/workspace-view'

test('parseDivergenceCount reads left as behind, right as ahead', () => {
  expect(parseDivergenceCount('1\t3')).toEqual({ ahead: 3, behind: 1 })
})

test('parseDivergenceCount accepts space-separated output with trailing newline', () => {
  expect(parseDivergenceCount('0 5\n')).toEqual({ ahead: 5, behind: 0 })
})

test('parseDivergenceCount returns undefined for unparseable output', () => {
  expect(parseDivergenceCount('')).toBeUndefined()
  expect(parseDivergenceCount('fatal: bad revision')).toBeUndefined()
})

test('parseShortstat reads insertions and deletions', () => {
  expect(parseShortstat(' 7 files changed, 149 insertions(+), 629 deletions(-)')).toEqual({
    added: 149,
    removed: 629,
  })
})

test('parseShortstat handles a one-sided diff', () => {
  // git omits the missing half entirely, and uses the singular form for 1.
  expect(parseShortstat(' 1 file changed, 1 insertion(+)')).toEqual({ added: 1, removed: 0 })
  expect(parseShortstat(' 2 files changed, 8 deletions(-)')).toEqual({ added: 0, removed: 8 })
})

test('parseShortstat gives up on a clean tree', () => {
  expect(parseShortstat('')).toBeUndefined()
  expect(parseShortstat(' 3 files changed')).toBeUndefined()
})

test('formatDiffCount keeps churn narrow enough for the sidebar', () => {
  expect(formatDiffCount(0)).toBe('0')
  expect(formatDiffCount(999)).toBe('999')
  expect(formatDiffCount(1000)).toBe('1k')
  expect(formatDiffCount(4823)).toBe('4.8k')
  expect(formatDiffCount(12_400)).toBe('12k')
})

test('formatDiffStat renders only the sides that changed', () => {
  expect(formatDiffStat({ added: 149, ahead: 1, behind: 0, removed: 629 })).toEqual({
    added: '+149',
    removed: '-629',
  })
  expect(formatDiffStat({ added: 3, ahead: 0, behind: 0 })).toEqual({ added: '+3', removed: '' })
  expect(formatDiffStat(undefined)).toEqual({ added: '', removed: '' })
})
