import { expect, test } from 'bun:test'

import { stripAnsi } from '../../src/auto-commit/strip-ansi'

test('passes plain text through', () => {
  expect(stripAnsi('hello world')).toBe('hello world')
})

test('strips SGR color codes', () => {
  expect(stripAnsi('\x1B[31merror\x1B[0m')).toBe('error')
})

test('strips cursor movement CSI sequences', () => {
  expect(stripAnsi('a\x1B[2Ab\x1B[1;1Hc')).toBe('abc')
})

test('strips OSC title-set sequences ending in BEL', () => {
  expect(stripAnsi('\x1B]0;my title\x07hello')).toBe('hello')
})

test('strips OSC sequences ending in ST', () => {
  expect(stripAnsi('\x1B]8;;https://x.test\x1B\\link\x1B]8;;\x1B\\')).toBe('link')
})

test('strips raw C0 controls except newline/tab', () => {
  expect(stripAnsi('a\x00b\x01c\tdef\nghi')).toBe('abc\tdef\nghi')
})

test('preserves newlines and tabs', () => {
  expect(stripAnsi('line1\nline2\tcol')).toBe('line1\nline2\tcol')
})
