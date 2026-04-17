import { describe, expect, test } from 'bun:test'

import { parseKeyNotation } from '../../src/input/keymap/key-chord'
import { formatChord, formatNotationForDisplay } from '../../src/input/keymap/key-format'

describe('formatChord', () => {
  test('formats modifier combos', () => {
    expect(formatChord('C-n')).toBe('Ctrl+N')
    expect(formatChord('C-M-x')).toBe('Ctrl+Alt+X')
    expect(formatChord('M-a')).toBe('Alt+A')
  })

  test('formats special keys', () => {
    expect(formatChord('escape')).toBe('Esc')
    expect(formatChord('return')).toBe('Enter')
    expect(formatChord('space')).toBe('Space')
    expect(formatChord('tab')).toBe('Tab')
    expect(formatChord('up')).toBe('↑')
  })

  test('formats shifted letter as Shift+X', () => {
    expect(formatChord('J')).toBe('Shift+J')
    expect(formatChord('L')).toBe('Shift+L')
  })

  test('passes through printable punctuation', () => {
    expect(formatChord('?')).toBe('?')
    expect(formatChord('|')).toBe('|')
  })

  test('marks the leader chord', () => {
    const leader = parseKeyNotation('<C-w>')[0]
    expect(formatChord('C-w', leader)).toBe('<leader>')
  })
})

describe('formatNotationForDisplay', () => {
  test('converts single notation tokens', () => {
    expect(formatNotationForDisplay('<C-n>')).toBe('Ctrl+N')
    expect(formatNotationForDisplay('<Esc>')).toBe('Esc')
    expect(formatNotationForDisplay('<CR>')).toBe('Enter')
  })

  test('joins multi-key sequences with spaces', () => {
    expect(formatNotationForDisplay('dd')).toBe('d d')
  })

  test('resolves <leader> token to the leader chord label', () => {
    const leader = parseKeyNotation('<C-w>')[0]
    expect(formatNotationForDisplay('<leader>t', leader)).toBe('<leader> t')
  })

  test('returns raw notation when parsing fails', () => {
    // parseKeyNotation throws when <leader> is used without a leader configured.
    expect(formatNotationForDisplay('<leader>')).toBe('<leader>')
  })
})
