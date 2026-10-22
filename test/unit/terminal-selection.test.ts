import { expect, test } from 'bun:test'

import type { TerminalLine } from '../../src/state/types'

import {
  expandAt,
  lineCells,
  rowColumns,
  type RowSource,
  selectionText,
  splitSpansAtColumns,
  unionRange,
} from '../../src/input/terminal-selection'

const WIDTH = 10

// Rows padded to WIDTH like real snapshots; `+` marks a soft-wrapped row.
function source(...rows: string[]): RowSource {
  const lines: TerminalLine[] = rows.map((row) => {
    const wrapped = row.startsWith('+')
    const text = (wrapped ? row.slice(1) : row).padEnd(WIDTH)
    return wrapped ? { spans: [{ text }], wrapped: true } : { spans: [{ text }] }
  })
  return (row) => lines[row]
}

test('soft-wrapped rows copy as one line, hard breaks keep their newline', () => {
  const rows = source('echo hello', '+ world', 'next')
  const range = { end: { col: 4, row: 2 }, start: { col: 0, row: 0 } }
  expect(selectionText(rows, range)).toBe('echo hello world\nnext')
})

test('trailing row padding is dropped, a wrapped row keeps its real spaces', () => {
  const rows = source('abc', 'echo ab c ', '+d')
  expect(selectionText(rows, { end: { col: WIDTH, row: 0 }, start: { col: 0, row: 0 } })).toBe(
    'abc'
  )
  expect(selectionText(rows, { end: { col: 2, row: 2 }, start: { col: 0, row: 1 } })).toBe(
    'echo ab c d'
  )
})

test('rows the UI never saw copy as empty lines', () => {
  const rows = source('a')
  expect(selectionText(rows, { end: { col: 1, row: 2 }, start: { col: 0, row: 0 } })).toBe('a\n\n')
})

test('word follows a soft wrap in both directions', () => {
  const rows = source('see https:', '+//x.io/abc', '+d done')
  const word = expandAt(rows, { col: 3, row: 1 }, 'word')
  expect(word).toEqual({ end: { col: 1, row: 2 }, start: { col: 4, row: 0 } })
  expect(selectionText(rows, word)).toBe('https://x.io/abcd')
})

test('word stops at a hard line break', () => {
  const rows = source('aaaaaaaaaa', 'bbb')
  expect(expandAt(rows, { col: 1, row: 1 }, 'word')).toEqual({
    end: { col: 3, row: 1 },
    start: { col: 0, row: 1 },
  })
})

test('word on a blank cell selects just that cell', () => {
  const rows = source('a b')
  expect(expandAt(rows, { col: 1, row: 0 }, 'word')).toEqual({
    end: { col: 2, row: 0 },
    start: { col: 1, row: 0 },
  })
})

test('line takes every row of the logical line', () => {
  const rows = source('prompt', 'long comma', '+nd here', 'out')
  const line = expandAt(rows, { col: 2, row: 2 }, 'line')
  expect(line).toEqual({ end: { col: WIDTH, row: 2 }, start: { col: 0, row: 1 } })
  expect(selectionText(rows, line)).toBe('long command here')
})

test('dragging back from a word keeps the whole anchor word', () => {
  const rows = source('one two three')
  const anchor = expandAt(rows, { col: 5, row: 0 }, 'word')
  const focus = expandAt(rows, { col: 1, row: 0 }, 'word')
  expect(selectionText(rows, unionRange(anchor, focus))).toBe('one two')
})

test('wide glyphs take two cells', () => {
  expect(lineCells({ spans: [{ text: 'a😀b' }] })).toEqual(['a', '😀', '', 'b'])
  const pieces = splitSpansAtColumns([{ text: 'a😀b' }], 1, 3)
  expect(pieces.map((p) => [p.span.text, p.selected])).toEqual([
    ['a', false],
    ['😀', true],
    ['b', false],
  ])
})

test('splitSpansAtColumns cuts across spans and keeps their style', () => {
  const pieces = splitSpansAtColumns(
    [
      { fg: '#111111', text: 'abc' },
      { bold: true, text: 'def' },
    ],
    2,
    4
  )
  expect(pieces).toEqual([
    { selected: false, span: { fg: '#111111', text: 'ab' } },
    { selected: true, span: { fg: '#111111', text: 'c' } },
    { selected: true, span: { bold: true, text: 'd' } },
    { selected: false, span: { bold: true, text: 'ef' } },
  ])
})

test('rowColumns spans full middle rows and clips the ends', () => {
  const range = { end: { col: 3, row: 7 }, start: { col: 4, row: 5 } }
  expect(rowColumns(range, 4, WIDTH)).toBeNull()
  expect(rowColumns(range, 5, WIDTH)).toEqual([4, WIDTH])
  expect(rowColumns(range, 6, WIDTH)).toEqual([0, WIDTH])
  expect(rowColumns(range, 7, WIDTH)).toEqual([0, 3])
})
