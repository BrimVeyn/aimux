import { describe, expect, test } from 'bun:test'

import {
  contentNeedsClipboard,
  expandSnippet,
  expandSnippetSync,
  type SyncExpansionContext,
} from '../../src/snippets/expand-variables'

const baseCtx: SyncExpansionContext = {
  branch: 'main',
  cwd: '/tmp/work',
  now: new Date('2026-05-19T14:32:07Z'),
}

describe('expandSnippetSync', () => {
  test('passes through plain text unchanged', () => {
    const result = expandSnippetSync('hello world', baseCtx)
    expect(result.text).toBe('hello world')
    expect(result.cursorOffset).toBe('hello world'.length)
  })

  test('expands {{date}} to ISO date', () => {
    const result = expandSnippetSync('today: {{date}}', baseCtx)
    expect(result.text).toBe('today: 2026-05-19')
  })

  test('expands {{date:FORMAT}} tokens', () => {
    const ctx: SyncExpansionContext = {
      ...baseCtx,
      now: new Date(2026, 4, 19, 7, 5, 9), // local 07:05:09
    }
    const result = expandSnippetSync('{{date:YYYY/MM/DD HH:mm:ss}}', ctx)
    expect(result.text).toBe('2026/05/19 07:05:09')
  })

  test('expands {{cwd}} and {{branch}}', () => {
    const result = expandSnippetSync('cwd={{cwd}} branch={{branch}}', baseCtx)
    expect(result.text).toBe('cwd=/tmp/work branch=main')
  })

  test('branch is empty string when null', () => {
    const result = expandSnippetSync('b={{branch}}', { ...baseCtx, branch: null })
    expect(result.text).toBe('b=')
  })

  test('leaves unknown variables literal', () => {
    const result = expandSnippetSync('hi {{unknown}}', baseCtx)
    expect(result.text).toBe('hi {{unknown}}')
  })

  test('clipboard variable is left literal in sync mode', () => {
    const result = expandSnippetSync('paste: {{clipboard}}', baseCtx)
    expect(result.text).toBe('paste: {{clipboard}}')
  })

  test('$| anchors cursor at first occurrence and strips later ones', () => {
    const result = expandSnippetSync('git commit -m "$|" $|after', baseCtx)
    expect(result.text).toBe('git commit -m "" after')
    expect(result.cursorOffset).toBe('git commit -m "'.length)
  })

  test('without $| the cursor lands at the end', () => {
    const result = expandSnippetSync('foo', baseCtx)
    expect(result.cursorOffset).toBe(3)
  })
})

describe('expandSnippet (async)', () => {
  test('resolves {{clipboard}} via the provided reader', async () => {
    const result = await expandSnippet('paste: {{clipboard}}', {
      ...baseCtx,
      clipboard: async () => 'CLIPBOARD',
    })
    expect(result.text).toBe('paste: CLIPBOARD')
  })

  test('does not call clipboard when not referenced', async () => {
    let called = false
    await expandSnippet('hello', {
      ...baseCtx,
      clipboard: async () => {
        called = true
        return ''
      },
    })
    expect(called).toBe(false)
  })
})

describe('contentNeedsClipboard', () => {
  test('detects {{clipboard}}', () => {
    expect(contentNeedsClipboard('hi {{clipboard}}')).toBe(true)
    expect(contentNeedsClipboard('hi {{ clipboard }}')).toBe(true)
    expect(contentNeedsClipboard('hi')).toBe(false)
  })
})
