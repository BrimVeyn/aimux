import { expect, test } from 'bun:test'

import type { TerminalLine } from '../../src/state/types'

import { getLineText, getLinkAtColumn } from '../../src/input/terminal-text-extraction'

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

test('getLinkAtColumn finds a plain URL and trims trailing punctuation', () => {
  const text = 'see (https://example.com/a?b=1). or http://localhost:3000'
  const line = makeLine(text)
  expect(getLinkAtColumn(line, 10)).toBe('https://example.com/a?b=1')
  expect(getLinkAtColumn(line, 30)).toBeNull()
  expect(getLinkAtColumn(line, 2)).toBeNull()
  expect(getLinkAtColumn(line, text.length - 1)).toBe('http://localhost:3000')
})

test('getLinkAtColumn prefers the OSC 8 target behind a label', () => {
  const line: TerminalLine = {
    spans: [{ text: '⏺ ' }, { link: 'https://google.com', text: 'google.com' }, { text: '  ' }],
  }
  expect(getLinkAtColumn(line, 2)).toBe('https://google.com')
  expect(getLinkAtColumn(line, 11)).toBe('https://google.com')
  expect(getLinkAtColumn(line, 0)).toBeNull()
  expect(getLinkAtColumn(line, 12)).toBeNull()
})
