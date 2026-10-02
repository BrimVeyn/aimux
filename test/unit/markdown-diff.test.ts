import { describe, expect, test } from 'bun:test'

import {
  type BlockEntry,
  diffLines,
  diffSpans,
  diffUnits,
  isMarkdownPath,
  parseUnits,
  plainText,
  sideOf,
  splitUnifiedDiff,
  type Unit,
} from '../../src/markdown-diff'
import { lcsDiff } from '../../src/markdown-diff/lcs'
import { appReducer, createInitialState } from '../../src/state/store'
import { resolveImagePath } from '../../src/ui/components/git/markdown-diff/md-image'

function text(unit: Unit): string {
  if ('spans' in unit) return plainText(unit.spans)
  if (unit.kind === 'code') return unit.lines.join('\n')
  return unit.kind
}

function summary(entries: readonly BlockEntry[]): string[] {
  return entries.map((e) => {
    if (e.type === 'added') return `+ ${text(e.new)}`
    if (e.type === 'removed') return `- ${text(e.old)}`
    if (e.type === 'modified') return `~ ${text(e.old)} → ${text(e.new)}`
    return `  ${text(e.new)}`
  })
}

describe('lcsDiff', () => {
  test('keeps common prefix and suffix, deletions before additions', () => {
    const ops = lcsDiff(['a', 'b', 'c', 'd'], ['a', 'x', 'y', 'd'], (s) => s)
    expect(ops.map((o) => o.type)).toEqual(['same', 'del', 'del', 'add', 'add', 'same'])
  })

  test('finds a kept element in the middle of a change', () => {
    const ops = lcsDiff(['a', 'b', 'c'], ['x', 'b', 'y'], (s) => s)
    expect(ops.filter((o) => o.type === 'same')).toHaveLength(1)
  })
})

describe('parseUnits', () => {
  test('flattens nested lists into items with a depth', () => {
    const units = parseUnits('- one\n  - nested\n- two\n\n1. first\n2. second\n')
    expect(units.map((u) => [u.kind, u.indent, u.kind === 'item' ? u.marker : ''])).toEqual([
      ['item', 0, '•'],
      ['item', 1, '•'],
      ['item', 0, '•'],
      ['item', 0, '1.'],
      ['item', 0, '2.'],
    ])
  })

  test('task items carry their checkbox as the marker', () => {
    const units = parseUnits('- [ ] todo\n- [x] done\n')
    expect(units.map((u) => (u.kind === 'item' ? u.marker : ''))).toEqual(['☐', '☑'])
    expect(units.map(text)).toEqual(['todo', 'done'])
  })

  test('keeps inline styling as span styles', () => {
    const [unit] = parseUnits('Some **bold**, *em*, `code` and [a link](https://x.y).')
    expect(unit?.kind).toBe('paragraph')
    if (unit?.kind !== 'paragraph') return
    expect(unit.spans.find((s) => s.text === 'bold')?.style).toEqual({ strong: true })
    expect(unit.spans.find((s) => s.text === 'code')?.style).toEqual({ code: true })
    expect(unit.spans.find((s) => s.text === 'a link')?.style).toEqual({ link: true })
  })

  test('a paragraph of only images becomes image units', () => {
    const units = parseUnits('![one](a.png) ![two](b.png)\n')
    expect(units.map((u) => (u.kind === 'image' ? u.src : u.kind))).toEqual(['a.png', 'b.png'])
  })

  test('quotes, code, tables and rules', () => {
    const units = parseUnits(
      '> quoted\n\n```ts\nconst a = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n---\n'
    )
    expect(units.map((u) => u.kind)).toEqual(['paragraph', 'code', 'table', 'rule'])
    expect(units[0]?.quote).toBe(true)
    const code = units[1]
    expect(code?.kind === 'code' && code.lang).toBe('ts')
    const table = units[2]
    expect(table?.kind === 'table' && table.rows.length).toBe(1)
  })
})

describe('diffUnits', () => {
  test('an edited paragraph is one modification, not a removal and an addition', () => {
    const entries = diffUnits(
      parseUnits('# Title\n\nThe quick brown fox jumps.\n'),
      parseUnits('# Title\n\nThe quick red fox jumps.\n')
    )
    expect(summary(entries)).toEqual([
      '  Title',
      '~ The quick brown fox jumps. → The quick red fox jumps.',
    ])
  })

  test('an unrelated replacement stays a removal and an addition', () => {
    const entries = diffUnits(
      parseUnits('Completely different text here.\n'),
      parseUnits('Nothing in common at all.\n')
    )
    expect(summary(entries)).toEqual([
      '- Completely different text here.',
      '+ Nothing in common at all.',
    ])
  })

  test('an added list item lands between the items around it', () => {
    const entries = diffUnits(parseUnits('- a\n- c\n'), parseUnits('- a\n- b\n- c\n'))
    expect(summary(entries)).toEqual(['  a', '+ b', '  c'])
  })

  test('an item added after edited ones stays in its list, ahead of removed blocks', () => {
    const entries = diffUnits(
      parseUnits('- [ ] PDF diff\n- [ ] Markdown diff\n\n## Old section\n\nGone now.\n'),
      parseUnits('- [x] PDF diff\n- [x] Markdown diff\n- [ ] Notebook diff\n')
    )
    expect(summary(entries)).toEqual([
      '~ PDF diff → PDF diff',
      '~ Markdown diff → Markdown diff',
      '+ Notebook diff',
      '- Old section',
      '- Gone now.',
    ])
  })

  test('only units of the same kind pair up', () => {
    const entries = diffUnits(parseUnits('Install the tool\n'), parseUnits('# Install the tool\n'))
    expect(entries.map((e) => e.type)).toEqual(['removed', 'added'])
  })
})

describe('diffSpans', () => {
  test('marks only the words that changed', () => {
    const before = parseUnits('The quick brown fox.')[0]
    const after = parseUnits('The quick red fox!')[0]
    if (before?.kind !== 'paragraph' || after?.kind !== 'paragraph') throw new Error('parse')
    const pieces = diffSpans(before.spans, after.spans)
    expect(pieces.filter((p) => p.op === 'del').map((p) => p.text)).toEqual(['brown', '.'])
    expect(pieces.filter((p) => p.op === 'add').map((p) => p.text)).toEqual(['red', '!'])
    expect(
      sideOf(pieces, 'old')
        .map((p) => p.text)
        .join('')
    ).toBe('The quick brown fox.')
    expect(
      sideOf(pieces, 'new')
        .map((p) => p.text)
        .join('')
    ).toBe('The quick red fox!')
  })

  test('a word made bold counts as changed', () => {
    const before = parseUnits('make it work')[0]
    const after = parseUnits('make it **work**')[0]
    if (before?.kind !== 'paragraph' || after?.kind !== 'paragraph') throw new Error('parse')
    const changed = diffSpans(before.spans, after.spans).filter((p) => p.op !== 'same')
    expect(changed.map((p) => `${p.op}:${p.text}`)).toEqual(['del:work', 'add:work'])
  })

  test('code blocks diff by line', () => {
    expect(diffLines(['a', 'b'], ['a', 'c']).map((l) => `${l.op}:${l.text}`)).toEqual([
      'same:a',
      'del:b',
      'add:c',
    ])
  })
})

describe('splitUnifiedDiff', () => {
  test('rebuilds both versions from a full-context patch', () => {
    const raw = [
      'diff --git a/x.md b/x.md',
      '--- a/x.md',
      '+++ b/x.md',
      '@@ -1,3 +1,3 @@',
      ' keep',
      '-old',
      '+new',
      ' --- not a header',
      '\\ No newline at end of file',
      '',
    ].join('\n')
    expect(splitUnifiedDiff(raw)).toEqual({
      after: 'keep\nnew\n--- not a header',
      before: 'keep\nold\n--- not a header',
    })
  })

  test('a new file has an empty old side', () => {
    expect(splitUnifiedDiff('@@ -0,0 +1,2 @@\n+a\n+b\n')).toEqual({ after: 'a\nb', before: '' })
  })
})

test('isMarkdownPath', () => {
  expect(isMarkdownPath('README.md')).toBe(true)
  expect(isMarkdownPath('docs/guide.MARKDOWN')).toBe(true)
  expect(isMarkdownPath('page.mdx')).toBe(false)
  expect(isMarkdownPath('md.ts')).toBe(false)
})

describe('resolveImagePath', () => {
  test('resolves relative to the document, inside the repo', () => {
    expect(resolveImagePath('/repo', 'docs/guide.md', '../assets/demo.png')).toBe(
      '/repo/assets/demo.png'
    )
    expect(resolveImagePath('/repo', 'docs/guide.md', './shot.png?raw=1')).toBe(
      '/repo/docs/shot.png'
    )
    expect(resolveImagePath('/repo', 'docs/guide.md', '/assets/a.png')).toBe('/repo/assets/a.png')
  })

  test('refuses what is not a local image', () => {
    expect(resolveImagePath('/repo', 'README.md', 'https://img.shields.io/x.svg')).toBeNull()
    expect(resolveImagePath('/repo', 'README.md', '../../etc/passwd.png')).toBeNull()
    expect(resolveImagePath('/repo', 'README.md', 'notes.txt')).toBeNull()
  })
})

describe('reducer', () => {
  test('r flips between rendered and source', () => {
    const s0 = createInitialState()
    expect(s0.gitMode.markdownView).toBe('rendered')
    const s1 = appReducer(s0, { type: 'git-mode-toggle-markdown-view' })
    expect(s1.gitMode.markdownView).toBe('source')
    const s2 = appReducer(s1, { type: 'git-mode-toggle-markdown-view' })
    expect(s2.gitMode.markdownView).toBe('rendered')
  })

  test('e unfolds a rendered document, and again folds it', () => {
    const s0 = createInitialState()
    const s1 = appReducer(s0, { key: 'k', type: 'git-mode-markdown-toggle-expand' })
    expect(s1.gitMode.markdownExpanded.k).toBe(true)
    const s2 = appReducer(s1, { key: 'k', type: 'git-mode-markdown-toggle-expand' })
    expect(s2.gitMode.markdownExpanded.k).toBeUndefined()
  })
})
