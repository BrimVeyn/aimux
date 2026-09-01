import { describe, expect, test } from 'bun:test'

import { PromptCapture } from '../../src/auto-rename/prompt-capture'

describe('PromptCapture', () => {
  test('captures the first non-empty submitted prompt', () => {
    const capture = new PromptCapture()
    expect(capture.feed('\r')).toEqual({ type: 'pending' })
    expect(capture.feed('Corrige ce bug\r')).toEqual({
      prompt: 'Corrige ce bug',
      type: 'submitted',
    })
  })

  test('applies backspace, word deletion and cursor edits', () => {
    const capture = new PromptCapture()
    capture.feed('fixx\x7f test old')
    capture.feed('\x17new')
    capture.feed('\x1b[D\x1b[D!')
    expect(capture.feed('\r')).toEqual({ prompt: 'fix test n!ew', type: 'submitted' })
  })

  test('applies common readline control-key edits', () => {
    const capture = new PromptCapture()
    capture.feed('middle\x01start \x05 end')
    capture.feed('\x02\x04!')
    capture.feed('\x0b done')

    expect(capture.feed('\r')).toEqual({ prompt: 'start middle en! done', type: 'submitted' })
  })

  test('handles fragmented application-mode and repeated cursor sequences', () => {
    const capture = new PromptCapture()
    capture.feed('abcd')
    capture.feed('\x1b')
    capture.feed('O')
    capture.feed('D')
    capture.feed('X')
    capture.feed('\x1b[2D')
    capture.feed('Y')
    capture.feed('\x1bOF!')

    expect(capture.feed('\r')).toEqual({ prompt: 'abYcXd!', type: 'submitted' })
  })

  test('marks a submission uncapturable after history navigation changes the editor buffer', () => {
    const capture = new PromptCapture()
    capture.feed('partial')
    capture.feed('\x1b')
    capture.feed('O')
    capture.feed('A')

    expect(capture.feed('unknown history value\r')).toEqual({ prompt: null, type: 'submitted' })
    expect(capture.feed('fresh prompt\r')).toEqual({ prompt: 'fresh prompt', type: 'submitted' })
  })

  test('marks modified cursor movement as uncapturable', () => {
    const capture = new PromptCapture()
    capture.feed('some words\x1b[1;5Dchanged')

    expect(capture.feed('\r')).toEqual({ prompt: null, type: 'submitted' })
  })

  test('marks unknown Meta editing sequences as uncapturable', () => {
    const capture = new PromptCapture()
    capture.feed('some words\x1bbchanged')

    expect(capture.feed('\r')).toEqual({ prompt: null, type: 'submitted' })
  })

  test('treats multiline bracketed paste as one prompt', () => {
    const capture = new PromptCapture()
    expect(capture.feed('\x1b[200~line one\nline two\x1b[201~')).toEqual({ type: 'pending' })
    expect(capture.feed('\r')).toEqual({ prompt: 'line one\nline two', type: 'submitted' })
  })

  test('clears cancelled input and ignores focus sequences', () => {
    const capture = new PromptCapture()
    capture.feed('discard me\x03')
    capture.feed('\x1b[Ikeep this')
    expect(capture.feed('\r')).toEqual({ prompt: 'keep this', type: 'submitted' })
  })

  test('caps captured content', () => {
    const capture = new PromptCapture()
    const result = capture.feed(`${'a'.repeat(9_000)} end\r`)
    expect(result.type).toBe('submitted')
    expect(result.type === 'submitted' ? result.prompt?.length : undefined).toBe(8_000)
  })
})
