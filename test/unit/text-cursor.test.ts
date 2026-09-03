import { describe, expect, test } from 'bun:test'

import { applyEdit, moveCursor } from '../../src/state/text-cursor'

const TEXT = 'first line\nsecond\n\nfourth line'
// offsets:    0…10       11…17  18 19…30

describe('moveCursor', () => {
  test('delta walks characters and clamps at both ends', () => {
    expect(moveCursor('abc', 1, { delta: -1 })).toBe(0)
    expect(moveCursor('abc', 0, { delta: -1 })).toBe(0)
    expect(moveCursor('abc', 3, { delta: 1 })).toBe(3)
  })

  test('home and end are line-wise, not buffer-wise', () => {
    expect(moveCursor(TEXT, 14, { to: 'home' })).toBe(11)
    expect(moveCursor(TEXT, 14, { to: 'end' })).toBe(17)
    // A cursor at column 0 must not be dragged past a leading newline.
    expect(moveCursor('\nabc', 0, { to: 'home' })).toBe(0)
    expect(moveCursor('one line', 3, { to: 'end' })).toBe(8)
  })

  test('word motion skips the gap then the word', () => {
    expect(moveCursor('foo bar baz', 11, { to: 'word-left' })).toBe(8)
    expect(moveCursor('foo bar baz', 8, { to: 'word-left' })).toBe(4)
    expect(moveCursor('foo bar', 0, { to: 'word-right' })).toBe(3)
    expect(moveCursor('foo  ', 3, { to: 'word-right' })).toBe(5)
  })

  test('up and down keep the column, or stop at a shorter line', () => {
    // column 4 of "first line" → column 4 of "second"
    expect(moveCursor(TEXT, 4, { to: 'line-down' })).toBe(15)
    expect(moveCursor(TEXT, 15, { to: 'line-up' })).toBe(4)
    // "second" → the empty line: there is no column 4 to land on
    expect(moveCursor(TEXT, 15, { to: 'line-down' })).toBe(18)
  })

  test('up on the first line parks at its start, down on the last at its end', () => {
    expect(moveCursor(TEXT, 4, { to: 'line-up' })).toBe(0)
    expect(moveCursor(TEXT, 22, { to: 'line-down' })).toBe(TEXT.length)
  })
})

describe('applyEdit', () => {
  test('inserts at the cursor, not at the end', () => {
    expect(applyEdit('ac', 1, 'b')).toEqual({ pos: 2, text: 'abc' })
  })

  test('backspace deletes behind, delete deletes in front', () => {
    expect(applyEdit('abc', 2, '\b')).toEqual({ pos: 1, text: 'ac' })
    expect(applyEdit('abc', 1, '\x7f')).toEqual({ pos: 1, text: 'ac' })
  })

  test('null at the edge it cannot cross, so the reducer can bail', () => {
    expect(applyEdit('abc', 0, '\b')).toBeNull()
    expect(applyEdit('abc', 3, '\x7f')).toBeNull()
  })
})
