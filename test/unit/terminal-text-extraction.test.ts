import { expect, test } from 'bun:test'

import type { TerminalLine } from '../../src/state/types'

import { getLineText, getWordAtColumn } from '../../src/input/terminal-text-extraction'

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
