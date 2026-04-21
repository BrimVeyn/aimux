import { expect, test } from 'bun:test'

import { extractSessionTail } from '../../src/app-runtime/auto-commit-driver'

test('returns placeholder when buffer is undefined', () => {
  expect(extractSessionTail(undefined)).toBe('[no session tail available]')
})

test('returns placeholder when buffer is empty after stripping', () => {
  expect(extractSessionTail('\x1B[31m\x1B[0m')).toBe('[no session tail available]')
})

test('strips ANSI from the buffer', () => {
  expect(extractSessionTail('\x1B[32m+added line\x1B[0m\n')).toBe('+added line')
})

test('caps at 8 KB, keeping the tail', () => {
  const long = `${'A'.repeat(20_000)}TAIL`
  const out = extractSessionTail(long)
  expect(out.length).toBe(8_000)
  expect(out.endsWith('TAIL')).toBe(true)
})
