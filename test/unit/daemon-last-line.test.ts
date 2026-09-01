import { describe, expect, test } from 'bun:test'

import type { TerminalLine, TerminalSnapshot } from '../../src/state/types'

import { lastNonBlankLine } from '../../src/pty/last-line'

function line(text: string): TerminalLine {
  return { spans: [{ text }] }
}

function snapshot(...texts: string[]): TerminalSnapshot {
  return { baseY: 0, cursorVisible: true, lines: texts.map(line), viewportY: 0 }
}

describe('lastNonBlankLine', () => {
  test('undefined viewport yields undefined', () => {
    expect(lastNonBlankLine(undefined)).toBeUndefined()
  })

  test('all-blank viewport yields undefined', () => {
    expect(lastNonBlankLine(snapshot('', '   ', '\t'))).toBeUndefined()
  })

  test('picks the last non-blank line, trimmed', () => {
    expect(lastNonBlankLine(snapshot('first', '  Running tests…  '))).toBe('Running tests…')
  })

  test('skips trailing blank rows', () => {
    expect(lastNonBlankLine(snapshot('working on it', '', '   '))).toBe('working on it')
  })
})
