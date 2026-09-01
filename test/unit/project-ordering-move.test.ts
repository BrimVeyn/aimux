import { describe, expect, test } from 'bun:test'

import { moveIdToIdPosition, moveIdToInsertIndex } from '../../src/ui/project-ordering'

describe('moveIdToInsertIndex', () => {
  test('moves to the top and to the bottom gap', () => {
    expect(moveIdToInsertIndex(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(moveIdToInsertIndex(['a', 'b', 'c'], 'a', 3)).toEqual(['b', 'c', 'a'])
  })

  test('gap index counts slots before removal', () => {
    expect(moveIdToInsertIndex(['a', 'b', 'c', 'd'], 'a', 3)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveIdToInsertIndex(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'c', 'b'])
  })

  test('both gaps around the dragged id are no-ops, by reference', () => {
    const input = ['a', 'b', 'c']
    expect(moveIdToInsertIndex(input, 'b', 1)).toBe(input)
    expect(moveIdToInsertIndex(input, 'b', 2)).toBe(input)
  })

  test('missing id returns the input reference unchanged', () => {
    const input = ['a', 'b', 'c']
    expect(moveIdToInsertIndex(input, 'z', 0)).toBe(input)
  })
})

describe('moveIdToIdPosition', () => {
  test('moves earlier id to a later slot, shifting the displaced id left', () => {
    expect(moveIdToIdPosition(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
  })

  test('moves later id into an earlier slot, shifting the displaced id right', () => {
    expect(moveIdToIdPosition(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  })

  test('adjacent swap', () => {
    expect(moveIdToIdPosition(['a', 'b', 'c'], 'a', 'b')).toEqual(['b', 'a', 'c'])
    expect(moveIdToIdPosition(['a', 'b', 'c'], 'c', 'b')).toEqual(['a', 'c', 'b'])
  })

  test('same id is a no-op', () => {
    const input = ['a', 'b', 'c']
    expect(moveIdToIdPosition(input, 'b', 'b')).toBe(input)
  })

  test('missing id returns the input reference unchanged', () => {
    const input = ['a', 'b', 'c']
    expect(moveIdToIdPosition(input, 'z', 'a')).toBe(input)
    expect(moveIdToIdPosition(input, 'a', 'z')).toBe(input)
  })

  test('returns a fresh array (does not mutate input) on a real move', () => {
    const input = ['a', 'b', 'c']
    const result = moveIdToIdPosition(input, 'a', 'c')
    expect(result).not.toBe(input)
    expect(input).toEqual(['a', 'b', 'c'])
  })
})
