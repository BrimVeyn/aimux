import { expect, test } from 'bun:test'

import type { FileDiffMetadata } from '../../src/diff-parser'

import { buildDiffSegments } from '../../src/ui/components/git/diff-renderer/build-rows'
import {
  changeBlockOffsets,
  changeBlocks,
  formatChangeBlock,
} from '../../src/ui/components/git/diff-renderer/hunks'

// Lines 1-10 unchanged, `old` → `new` at line 11, lines 12-19 unchanged, then a
// pure deletion of two lines after line 19.
function makeFile(): FileDiffMetadata {
  const ctx = (n: number, from: number) => Array.from({ length: n }, (_, i) => `ctx${from + i}\n`)
  return {
    additionLines: [...ctx(10, 1), 'new\n', ...ctx(8, 12)],
    deletionLines: [...ctx(10, 1), 'old\n', ...ctx(8, 12), 'gone1\n', 'gone2\n'],
    hunks: [
      {
        additionCount: 19,
        additionLineIndex: 0,
        additionLines: 1,
        additionStart: 1,
        collapsedBefore: 0,
        deletionCount: 21,
        deletionLineIndex: 0,
        deletionLines: 3,
        deletionStart: 1,
        hunkContent: [
          { additionLineIndex: 0, deletionLineIndex: 0, lines: 10, type: 'context' },
          {
            additionLineIndex: 10,
            additions: 1,
            deletionLineIndex: 10,
            deletions: 1,
            type: 'change',
          },
          { additionLineIndex: 11, deletionLineIndex: 11, lines: 8, type: 'context' },
          {
            additionLineIndex: 19,
            additions: 0,
            deletionLineIndex: 19,
            deletions: 2,
            type: 'change',
          },
        ],
        noEOFCRAdditions: false,
        noEOFCRDeletions: false,
        splitLineCount: 21,
        splitLineStart: 0,
        unifiedLineCount: 22,
        unifiedLineStart: 0,
      },
    ],
    isPartial: false,
    name: 'sample.ts',
    splitLineCount: 21,
    type: 'change',
    unifiedLineCount: 22,
  }
}

test('changeBlocks numbers each run of changed lines on both sides', () => {
  const blocks = changeBlocks(makeFile())
  expect(blocks).toHaveLength(2)
  expect(blocks[0]).toMatchObject({
    additions: 1,
    addLine: 11,
    deletions: 1,
    delLine: 11,
    id: '0:1',
  })
  expect(blocks[1]).toMatchObject({
    additions: 0,
    addLine: 20,
    deletions: 2,
    delLine: 20,
    id: '0:3',
  })
})

test('formatChangeBlock names the new lines, or the old ones for a deletion', () => {
  const file = makeFile()
  const [edit, removal] = changeBlocks(file)
  if (!edit || !removal) throw new Error('expected two blocks')
  expect(formatChangeBlock(file, edit, 'src/a.ts')).toBe('src/a.ts:11\n```diff\n-old\n+new\n```\n')
  expect(formatChangeBlock(file, removal, 'src/a.ts')).toBe(
    'src/a.ts:20-21 (deleted)\n```diff\n-gone1\n-gone2\n```\n'
  )
})

test('formatChangeBlock grows the fence past one inside the code', () => {
  const file = makeFile()
  file.additionLines[10] = 'const s = "```"\n'
  const [edit] = changeBlocks(file)
  if (!edit) throw new Error('expected a block')
  expect(formatChangeBlock(file, edit, 'a.md')).toBe(
    'a.md:11\n````diff\n-old\n+const s = "```"\n````\n'
  )
})

test('changeBlockOffsets lands on the rows the view draws, folds included', () => {
  const file = makeFile()
  const { segments } = buildDiffSegments(file)
  // Header, 7 lines folded into one row, the 3 kept above the change, then the
  // change; the 8 lines after it are too few to fold, so the deletion follows.
  const widths = { left: 80, right: 80 }
  expect(changeBlockOffsets(file, segments, widths, 'split')).toEqual([5, 14])
  // Stacked draws a deletion and its addition on rows of their own.
  expect(changeBlockOffsets(file, segments, widths, 'stacked')).toEqual([5, 15])
})
