import { expect, test } from 'bun:test'

import type { FileDiffMetadata } from '../../src/diff-parser'

import {
  buildDiffSegments,
  CHANGE_SEGMENT_CHUNK_LINES,
  CONTEXT_SEGMENT_CHUNK_LINES,
  type FoldMap,
} from '../../src/ui/components/git/diff-renderer/build-rows'

function makeLine(prefix: string, index: number): string {
  return `${prefix}-${index}\n`
}

function makeFile(overrides: Partial<FileDiffMetadata> = {}): FileDiffMetadata {
  return {
    additionLines: [],
    deletionLines: [],
    hunks: [],
    isPartial: false,
    name: 'sample.ts',
    splitLineCount: 0,
    type: 'change',
    unifiedLineCount: 0,
    ...overrides,
  }
}

test('buildDiffSegments chunks expanded context while preserving fold ids and numbering', () => {
  const lines = Array.from({ length: 200 }, (_, index) => makeLine('ctx', index))
  const file = makeFile({
    additionLines: [...lines, 'add\n'],
    deletionLines: [...lines, 'del\n'],
    hunks: [
      {
        additionCount: 201,
        additionLineIndex: 0,
        additionLines: 201,
        additionStart: 1,
        collapsedBefore: 0,
        deletionCount: 201,
        deletionLineIndex: 0,
        deletionLines: 201,
        deletionStart: 1,
        hunkContent: [
          { additionLineIndex: 0, deletionLineIndex: 0, lines: 150, type: 'context' },
          {
            additionLineIndex: 150,
            additions: 1,
            deletionLineIndex: 150,
            deletions: 1,
            type: 'change',
          },
        ],
        noEOFCRAdditions: false,
        noEOFCRDeletions: false,
        splitLineCount: 151,
        splitLineStart: 0,
        unifiedLineCount: 151,
        unifiedLineStart: 0,
      },
    ],
  })
  const folds: FoldMap = { '0:0': { bottom: 0, top: 130 } }

  const { segments } = buildDiffSegments(file, folds)
  const contextSegments = segments.filter((segment) => segment.kind === 'context')
  const foldSegments = segments.filter((segment) => segment.kind === 'fold')

  expect(contextSegments.map((segment) => segment.count)).toEqual([
    CONTEXT_SEGMENT_CHUNK_LINES,
    CONTEXT_SEGMENT_CHUNK_LINES,
    2,
    3,
  ])
  expect(contextSegments.map((segment) => segment.addLineNumberStart)).toEqual([1, 65, 129, 148])
  expect(contextSegments.map((segment) => segment.delLineNumberStart)).toEqual([1, 65, 129, 148])
  expect(foldSegments).toHaveLength(1)
  expect(foldSegments[0]?.fold.foldId).toBe('0:0')
})

test('buildDiffSegments chunks asymmetric change blocks by aligned diff position', () => {
  const additions = Array.from({ length: 150 }, (_, index) => makeLine('add', index))
  const deletions = Array.from({ length: 10 }, (_, index) => makeLine('del', index))
  const file = makeFile({
    additionLines: additions,
    deletionLines: deletions,
    hunks: [
      {
        additionCount: 150,
        additionLineIndex: 0,
        additionLines: 150,
        additionStart: 20,
        collapsedBefore: 0,
        deletionCount: 10,
        deletionLineIndex: 0,
        deletionLines: 10,
        deletionStart: 10,
        hunkContent: [
          {
            additionLineIndex: 0,
            additions: 150,
            deletionLineIndex: 0,
            deletions: 10,
            type: 'change',
          },
        ],
        noEOFCRAdditions: false,
        noEOFCRDeletions: false,
        splitLineCount: 150,
        splitLineStart: 0,
        unifiedLineCount: 160,
        unifiedLineStart: 0,
      },
    ],
  })

  const { firstChangeOffset, segments } = buildDiffSegments(file)
  const changeSegments = segments.filter((segment) => segment.kind === 'change')

  expect(firstChangeOffset).toBe(1)
  expect(changeSegments.map((segment) => segment.additions)).toEqual([
    CHANGE_SEGMENT_CHUNK_LINES,
    CHANGE_SEGMENT_CHUNK_LINES,
    22,
  ])
  expect(changeSegments.map((segment) => segment.deletions)).toEqual([10, 0, 0])
  expect(changeSegments.map((segment) => segment.addLineNumberStart)).toEqual([20, 84, 148])
  expect(changeSegments.map((segment) => segment.delLineNumberStart)).toEqual([10, 74, 138])
  expect(changeSegments.map((segment) => segment.offset)).toEqual([1, 65, 129])
})
