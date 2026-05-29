import { expect, test } from 'bun:test'

import type { TerminalLine } from '../../src/state/types'

import {
  extractStreamText,
  getLineText,
  getWordAtColumn,
} from '../../src/input/terminal-text-extraction'

function makeLine(text: string): TerminalLine {
  return { spans: [{ text }] }
}

function makeMultiSpanLine(...texts: string[]): TerminalLine {
  return { spans: texts.map((text) => ({ text })) }
}

test('getLineText concatenates spans', () => {
  const line = makeMultiSpanLine('hello', ' ', 'world')
  expect(getLineText(line)).toBe('hello world')
})

test('getLineText with single span', () => {
  const line = makeLine('foobar')
  expect(getLineText(line)).toBe('foobar')
})

test('getLineText with empty spans', () => {
  const line: TerminalLine = { spans: [] }
  expect(getLineText(line)).toBe('')
})

test('getWordAtColumn selects a simple word', () => {
  const result = getWordAtColumn('hello world', 1)
  expect(result).toEqual({ endCol: 5, startCol: 0, text: 'hello' })
})

test('getWordAtColumn selects second word', () => {
  const result = getWordAtColumn('hello world', 7)
  expect(result).toEqual({ endCol: 11, startCol: 6, text: 'world' })
})

test('getWordAtColumn on whitespace returns empty', () => {
  const result = getWordAtColumn('hello world', 5)
  expect(result.text).toBe('')
})

test('getWordAtColumn selects a file path', () => {
  const result = getWordAtColumn('cat /usr/bin/node ok', 8)
  expect(result).toEqual({ endCol: 17, startCol: 4, text: '/usr/bin/node' })
})

test('getWordAtColumn at start of line', () => {
  const result = getWordAtColumn('hello world', 0)
  expect(result).toEqual({ endCol: 5, startCol: 0, text: 'hello' })
})

test('getWordAtColumn at end of word', () => {
  const result = getWordAtColumn('hello world', 4)
  expect(result).toEqual({ endCol: 5, startCol: 0, text: 'hello' })
})

test('getWordAtColumn out of bounds returns empty', () => {
  const result = getWordAtColumn('hello', 10)
  expect(result.text).toBe('')
})

test('getWordAtColumn negative column returns empty', () => {
  const result = getWordAtColumn('hello', -1)
  expect(result.text).toBe('')
})

test('getWordAtColumn on special chars selects run of non-whitespace', () => {
  const result = getWordAtColumn('foo === bar', 5)
  expect(result).toEqual({ endCol: 7, startCol: 4, text: '===' })
})

test('getWordAtColumn with URL-like text', () => {
  const result = getWordAtColumn('visit https://example.com/path end', 10)
  expect(result).toEqual({
    endCol: 30,
    startCol: 6,
    text: 'https://example.com/path',
  })
})

test('extractStreamText single line slice', () => {
  const lines = [makeLine('hello world')]
  expect(extractStreamText(lines, 0, 6, 0, 11)).toBe('world')
})

test('extractStreamText multi-line stream anchor to focus', () => {
  const lines = [
    makeLine('first line here'),
    makeLine('middle full line'),
    makeLine('last line end'),
  ]
  expect(extractStreamText(lines, 0, 6, 2, 4)).toBe('line here\nmiddle full line\nlast')
})

test('extractStreamText reversed selection is normalized', () => {
  const lines = [makeLine('alpha'), makeLine('beta'), makeLine('gamma')]
  const forward = extractStreamText(lines, 0, 2, 2, 3)
  const reverse = extractStreamText(lines, 2, 3, 0, 2)
  expect(forward).toBe('pha\nbeta\ngam')
  expect(reverse).toBe(forward)
})

test('extractStreamText same row reversed cols is normalized', () => {
  const lines = [makeLine('abcdef')]
  expect(extractStreamText(lines, 0, 4, 0, 1)).toBe('bcd')
})

test('extractStreamText empty middle line yields empty segment', () => {
  const lines = [makeLine('top'), makeLine(''), makeLine('bottom')]
  expect(extractStreamText(lines, 0, 1, 2, 3)).toBe('op\n\nbot')
})

test('extractStreamText concatenates multi-span lines', () => {
  const lines = [makeMultiSpanLine('foo', ' ', 'bar'), makeMultiSpanLine('baz')]
  expect(extractStreamText(lines, 0, 4, 1, 3)).toBe('bar\nbaz')
})

test('extractStreamText clamps rows out of bounds', () => {
  const lines = [makeLine('only')]
  expect(extractStreamText(lines, -5, 0, 10, 4)).toBe('only')
})

test('extractStreamText clamps negative cols to zero', () => {
  const lines = [makeLine('hello')]
  expect(extractStreamText(lines, 0, -3, 0, 4)).toBe('hell')
})

test('extractStreamText rtrims trailing padding on multi-line join', () => {
  const lines = [
    makeLine('echo "a" && \\          '),
    makeLine('  echo "b" && \\        '),
    makeLine('  echo "c"              '),
  ]
  expect(extractStreamText(lines, 0, 0, 2, 24)).toBe('echo "a" && \\\n  echo "b" && \\\n  echo "c"')
})

test('extractStreamText rtrims single-line trailing spaces (row padding is synthetic)', () => {
  // Every rendered row is padded to the full terminal width to prevent
  // ghosting, so trailing spaces on a single-row copy are padding, not content.
  const lines = [makeLine('abc   ')]
  expect(extractStreamText(lines, 0, 0, 0, 6)).toBe('abc')
})
