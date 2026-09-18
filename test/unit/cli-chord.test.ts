import { describe, expect, test } from 'bun:test'

import { bracketedPaste, notationToBytes, PASTE_MIN_BYTES } from '../../src/cli/chord'

describe('cli chord encoder', () => {
  test('lowers Ctrl-letter into the control byte', () => {
    expect(notationToBytes('<C-c>')).toEqual(Buffer.from([0x03]))
    expect(notationToBytes('<C-z>')).toEqual(Buffer.from([0x1a]))
  })

  test('lowers special keys', () => {
    expect(notationToBytes('<Esc>')).toEqual(Buffer.from([0x1b]))
    expect(notationToBytes('<CR>')).toEqual(Buffer.from([0x0d]))
    expect(notationToBytes('<Tab>')).toEqual(Buffer.from([0x09]))
    expect(notationToBytes('<Space>')).toEqual(Buffer.from([0x20]))
    expect(notationToBytes('<BS>')).toEqual(Buffer.from([0x7f]))
  })

  test('lowers arrow keys to CSI sequences', () => {
    expect(notationToBytes('<Up>')).toEqual(Buffer.from([0x1b, 0x5b, 0x41]))
    expect(notationToBytes('<Down>')).toEqual(Buffer.from([0x1b, 0x5b, 0x42]))
    expect(notationToBytes('<Right>')).toEqual(Buffer.from([0x1b, 0x5b, 0x43]))
    expect(notationToBytes('<Left>')).toEqual(Buffer.from([0x1b, 0x5b, 0x44]))
  })

  test('concatenates chord sequences in order', () => {
    expect(notationToBytes('<Esc><CR>ab')).toEqual(Buffer.from([0x1b, 0x0d, 0x61, 0x62]))
  })

  test('bracketed paste wraps multi-line strings, passes short lines through', () => {
    expect(bracketedPaste('hi')).toBe('hi')
    expect(bracketedPaste('a\nb')).toBe('\x1b[200~a\nb\x1b[201~')
  })

  test('bracketed paste wraps a long single line', () => {
    // Regression: a >1 KiB single line was typed, split into tty-sized reads,
    // and Claude Code kept only the last read on submit.
    const long = 'é'.repeat(PASTE_MIN_BYTES) // 2 bytes each
    expect(bracketedPaste(long)).toBe(`\x1b[200~${long}\x1b[201~`)
    const atLimit = 'a'.repeat(PASTE_MIN_BYTES)
    expect(bracketedPaste(atLimit)).toBe(atLimit)
    expect(bracketedPaste(`${atLimit}a`)).toBe(`\x1b[200~${atLimit}a\x1b[201~`)
  })
})
