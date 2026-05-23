import { expect, test } from 'bun:test'

import { parseDivergenceCount } from '../../src/git/divergence'

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
