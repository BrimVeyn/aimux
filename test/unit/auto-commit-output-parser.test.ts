import { expect, test } from 'bun:test'

import { parseSuggestion } from '../../src/auto-commit/output-parser'

test('parses TITLE and BODY', () => {
  const input = 'TITLE: feat: add wand glyph\nBODY:\nShows the wand in git-panel when ready.\n'
  expect(parseSuggestion(input)).toEqual({
    body: 'Shows the wand in git-panel when ready.',
    title: 'feat: add wand glyph',
  })
})

test('parses empty body as empty string', () => {
  const input = 'TITLE: fix: typo\nBODY:\n'
  expect(parseSuggestion(input)).toEqual({ body: '', title: 'fix: typo' })
})

test('tolerates leading/trailing whitespace', () => {
  const input = '  \n\nTITLE:   chore: bump   \nBODY:\n  some body  \n\n'
  expect(parseSuggestion(input)).toEqual({ body: 'some body', title: 'chore: bump' })
})

test('multi-line body preserved between BODY: and EOF', () => {
  const input = 'TITLE: t\nBODY:\nline 1\nline 2\n\nline 4\n'
  expect(parseSuggestion(input)).toEqual({ body: 'line 1\nline 2\n\nline 4', title: 't' })
})

test('returns null when TITLE missing', () => {
  expect(parseSuggestion('BODY:\nno title here')).toBeNull()
})

test('returns null when TITLE is empty', () => {
  expect(parseSuggestion('TITLE:\nBODY:\nsomething')).toBeNull()
})

test('treats missing BODY marker as empty body', () => {
  expect(parseSuggestion('TITLE: only title, no body marker')).toEqual({
    body: '',
    title: 'only title, no body marker',
  })
})
