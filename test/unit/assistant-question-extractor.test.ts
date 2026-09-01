import { describe, expect, test } from 'bun:test'

import type { TerminalLine, TerminalSnapshot } from '../../src/state/types'

import { extractQuestion } from '../../src/pty/assistant-question-extractor'

function snapshot(...lines: string[]): TerminalSnapshot {
  const terminalLines: TerminalLine[] = lines.map((text) => ({ spans: [{ text }] }))
  return { baseY: 0, cursorVisible: true, lines: terminalLines, viewportY: 0 }
}

describe('extractQuestion', () => {
  test('returns null when there is no viewport', () => {
    expect(extractQuestion('claude', undefined)).toBeNull()
  })

  test('returns null on a blank screen', () => {
    expect(extractQuestion('claude', snapshot('', '   ', ''))).toBeNull()
  })

  test('claude numbered permission menu → permission + parsed options', () => {
    const detail = extractQuestion(
      'claude',
      snapshot(
        'Do you want to make this edit to foo.ts?',
        '❯ 1. Yes',
        "  2. Yes, and don't ask again",
        '  3. No, and tell Claude what to do differently'
      )
    )
    expect(detail?.kind).toBe('permission')
    expect(detail?.options).toEqual([
      'Yes',
      "Yes, and don't ask again",
      'No, and tell Claude what to do differently',
    ])
    expect(detail?.prompt).toContain('Do you want to make this edit')
  })

  test('generic [y/n] prompt → question + Yes/No options', () => {
    const detail = extractQuestion('custom', snapshot('Continue? [y/n]'))
    expect(detail?.kind).toBe('question')
    expect(detail?.options).toEqual(['Yes', 'No'])
  })

  test('opencode permission banner → permission + numbered options', () => {
    const detail = extractQuestion(
      'opencode',
      snapshot('△ Permission required', 'Allow edit to file.ts?', '1. Allow', '2. Deny')
    )
    expect(detail?.kind).toBe('permission')
    expect(detail?.options).toEqual(['Allow', 'Deny'])
  })

  test('codex confirm without a menu → permission, no options', () => {
    const detail = extractQuestion('codex', snapshot('Apply patch?', 'Press Enter to confirm'))
    expect(detail?.kind).toBe('permission')
    expect(detail?.options).toBeUndefined()
  })

  test('free-form question with no choices → question, prompt captured, no options', () => {
    const detail = extractQuestion('claude', snapshot('What database should the migration target?'))
    expect(detail?.kind).toBe('question')
    expect(detail?.options).toBeUndefined()
    expect(detail?.prompt).toBe('What database should the migration target?')
  })

  test('grok plan approval prompt → permission kind (via shared signals) + prompt captured', () => {
    const detail = extractQuestion(
      'grok',
      snapshot(
        'Bottom Line',
        'Swap legacy projects for JWT + rotation',
        '[ a ] pprove [ c ] omment [ q ] uit plan'
      )
    )
    expect(detail?.kind).toBe('permission') // "approve" triggers it
    expect(detail?.prompt).toContain('[ a ] pprove')
    expect(detail?.options).toBeUndefined() // not a numbered/marked list in this snapshot
  })

  test('prompt is trailing-trimmed and joins the non-blank tail', () => {
    const detail = extractQuestion('custom', snapshot('line one   ', 'line two [y/n]  ', '', ''))
    expect(detail?.prompt).toBe('line one\nline two [y/n]')
  })
})
