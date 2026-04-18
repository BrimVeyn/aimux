import type { FileDiffMetadata, Hunk, HunkContent } from '../../../diff-parser'
import type { FoldState } from '../../../state/types'

export const KEEP_CONTEXT = 3
export const MIN_FOLD_SIZE = 3
export const FOLD_STEP = 5

export interface FoldInfo {
  foldId: string
  total: number
  hidden: number
  topExpanded: number
  bottomExpanded: number
}

export type SplitCell =
  | { content: string; lineIdx: number; lineNumber: number; type: 'context' }
  | { content: string; lineIdx: number; lineNumber: number; type: 'addition' | 'deletion' }
  | { fold: FoldInfo; type: 'fold' }
  | { type: 'filler' }

export interface SplitRow {
  type: 'row'
  left: SplitCell
  right: SplitCell
}

export type UnifiedRow =
  | {
      addLineNumber: number
      content: string
      lineIdx: number
      delLineNumber: number
      type: 'context'
    }
  | {
      content: string
      lineIdx: number
      lineNumber: number
      type: 'addition' | 'deletion'
    }
  | { fold: FoldInfo; type: 'fold' }

export interface HunkHeader {
  context?: string
  spec: string
  type: 'hunk-header'
}

export type SplitRowOrHeader = HunkHeader | SplitRow
export type UnifiedRowOrHeader = HunkHeader | UnifiedRow

export type FoldMap = Record<string, FoldState>

interface ContextSlice {
  // which file-line indices (relative to content start) to show, and which to fold
  leadingVisible: number
  fold: { length: number; offset: number } | null
  trailingVisible: number
}

function sliceContext(
  totalLines: number,
  hasChangeBefore: boolean,
  hasChangeAfter: boolean,
  fold: FoldState
): ContextSlice {
  const preKeep = hasChangeBefore ? Math.min(KEEP_CONTEXT, totalLines) : 0
  const postKeep = hasChangeAfter ? Math.min(KEEP_CONTEXT, totalLines - preKeep) : 0
  const middle = totalLines - preKeep - postKeep
  if (middle < MIN_FOLD_SIZE) {
    return { fold: null, leadingVisible: totalLines, trailingVisible: 0 }
  }
  const top = Math.min(fold.top, middle)
  const bottom = Math.min(fold.bottom, middle - top)
  const hidden = middle - top - bottom
  if (hidden <= 0) {
    return { fold: null, leadingVisible: totalLines, trailingVisible: 0 }
  }
  return {
    fold: { length: hidden, offset: preKeep + top },
    leadingVisible: preKeep + top,
    trailingVisible: postKeep + bottom,
  }
}

function makeFoldInfo(foldId: string, middle: number, fold: FoldState, hidden: number): FoldInfo {
  const topExpanded = Math.min(fold.top, middle)
  const bottomExpanded = Math.min(fold.bottom, middle - topExpanded)
  return { bottomExpanded, foldId, hidden, topExpanded, total: middle }
}

function contextNeighbors(
  contents: HunkContent[],
  index: number
): { hasChangeBefore: boolean; hasChangeAfter: boolean } {
  let hasChangeBefore = false
  for (let i = index - 1; i >= 0; i--) {
    const c = contents[i]
    if (c && c.type !== 'context') {
      hasChangeBefore = true
      break
    }
  }
  let hasChangeAfter = false
  for (let i = index + 1; i < contents.length; i++) {
    const c = contents[i]
    if (c && c.type !== 'context') {
      hasChangeAfter = true
      break
    }
  }
  return { hasChangeAfter, hasChangeBefore }
}

export function buildSplitRows(file: FileDiffMetadata, folds: FoldMap = {}): SplitRowOrHeader[] {
  const rows: SplitRowOrHeader[] = []
  for (const [hIdx, hunk] of file.hunks.entries()) {
    rows.push(makeHeader(hunk))
    let delLine = hunk.deletionStart
    let addLine = hunk.additionStart
    for (const [cIdx, content] of hunk.hunkContent.entries()) {
      if (content.type === 'context') {
        const foldId = `${hIdx}:${cIdx}`
        const { hasChangeAfter, hasChangeBefore } = contextNeighbors(hunk.hunkContent, cIdx)
        const foldState = folds[foldId] ?? { bottom: 0, top: 0 }
        const slice = sliceContext(content.lines, hasChangeBefore, hasChangeAfter, foldState)

        const pushContext = (start: number, count: number): void => {
          for (let i = 0; i < count; i++) {
            const offset = start + i
            const addIdx = content.additionLineIndex + offset
            const delIdx = content.deletionLineIndex + offset
            const text = stripNewline(file.additionLines[addIdx] ?? '')
            rows.push({
              left: { content: text, lineIdx: delIdx, lineNumber: delLine++, type: 'context' },
              right: { content: text, lineIdx: addIdx, lineNumber: addLine++, type: 'context' },
              type: 'row',
            })
          }
        }

        pushContext(0, slice.leadingVisible)
        if (slice.fold) {
          const preKeep = hasChangeBefore ? Math.min(KEEP_CONTEXT, content.lines) : 0
          const postKeep = hasChangeAfter ? Math.min(KEEP_CONTEXT, content.lines - preKeep) : 0
          const middle = content.lines - preKeep - postKeep
          const info = makeFoldInfo(foldId, middle, foldState, slice.fold.length)
          rows.push({
            left: { fold: info, type: 'fold' },
            right: { fold: info, type: 'fold' },
            type: 'row',
          })
          delLine += slice.fold.length
          addLine += slice.fold.length
          pushContext(slice.fold.offset + slice.fold.length, slice.trailingVisible)
        }
      } else {
        const max = Math.max(content.additions, content.deletions)
        for (let i = 0; i < max; i++) {
          const delIdx = content.deletionLineIndex + i
          const addIdx = content.additionLineIndex + i
          const left: SplitCell =
            i < content.deletions
              ? {
                  content: stripNewline(file.deletionLines[delIdx] ?? ''),
                  lineIdx: delIdx,
                  lineNumber: delLine++,
                  type: 'deletion',
                }
              : { type: 'filler' }
          const right: SplitCell =
            i < content.additions
              ? {
                  content: stripNewline(file.additionLines[addIdx] ?? ''),
                  lineIdx: addIdx,
                  lineNumber: addLine++,
                  type: 'addition',
                }
              : { type: 'filler' }
          rows.push({ left, right, type: 'row' })
        }
      }
    }
  }
  return rows
}

export function buildUnifiedRows(
  file: FileDiffMetadata,
  folds: FoldMap = {}
): UnifiedRowOrHeader[] {
  const rows: UnifiedRowOrHeader[] = []
  for (const [hIdx, hunk] of file.hunks.entries()) {
    rows.push(makeHeader(hunk))
    let delLine = hunk.deletionStart
    let addLine = hunk.additionStart
    for (const [cIdx, content] of hunk.hunkContent.entries()) {
      if (content.type === 'context') {
        const foldId = `${hIdx}:${cIdx}`
        const { hasChangeAfter, hasChangeBefore } = contextNeighbors(hunk.hunkContent, cIdx)
        const foldState = folds[foldId] ?? { bottom: 0, top: 0 }
        const slice = sliceContext(content.lines, hasChangeBefore, hasChangeAfter, foldState)

        const pushContext = (start: number, count: number): void => {
          for (let i = 0; i < count; i++) {
            const offset = start + i
            const addIdx = content.additionLineIndex + offset
            const text = stripNewline(file.additionLines[addIdx] ?? '')
            rows.push({
              addLineNumber: addLine++,
              content: text,
              delLineNumber: delLine++,
              lineIdx: addIdx,
              type: 'context',
            })
          }
        }

        pushContext(0, slice.leadingVisible)
        if (slice.fold) {
          const preKeep = hasChangeBefore ? Math.min(KEEP_CONTEXT, content.lines) : 0
          const postKeep = hasChangeAfter ? Math.min(KEEP_CONTEXT, content.lines - preKeep) : 0
          const middle = content.lines - preKeep - postKeep
          const info = makeFoldInfo(foldId, middle, foldState, slice.fold.length)
          rows.push({ fold: info, type: 'fold' })
          delLine += slice.fold.length
          addLine += slice.fold.length
          pushContext(slice.fold.offset + slice.fold.length, slice.trailingVisible)
        }
      } else {
        for (let i = 0; i < content.deletions; i++) {
          const delIdx = content.deletionLineIndex + i
          rows.push({
            content: stripNewline(file.deletionLines[delIdx] ?? ''),
            lineIdx: delIdx,
            lineNumber: delLine++,
            type: 'deletion',
          })
        }
        for (let i = 0; i < content.additions; i++) {
          const addIdx = content.additionLineIndex + i
          rows.push({
            content: stripNewline(file.additionLines[addIdx] ?? ''),
            lineIdx: addIdx,
            lineNumber: addLine++,
            type: 'addition',
          })
        }
      }
    }
  }
  return rows
}

export function firstChangeRowIndex(
  rows: readonly (SplitRowOrHeader | UnifiedRowOrHeader)[]
): number {
  for (const [i, row] of rows.entries()) {
    if (row.type === 'row') {
      if (row.left.type === 'addition' || row.left.type === 'deletion') return i
      if (row.right.type === 'addition' || row.right.type === 'deletion') return i
      continue
    }
    if (row.type === 'addition' || row.type === 'deletion') return i
  }
  return -1
}

function makeHeader(hunk: Hunk): HunkHeader {
  const spec = `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`
  return { context: hunk.hunkContext, spec, type: 'hunk-header' }
}

function stripNewline(s: string): string {
  if (s.endsWith('\r\n')) return s.slice(0, -2)
  if (s.endsWith('\n')) return s.slice(0, -1)
  return s
}

export function gutterWidth(file: FileDiffMetadata): number {
  let max = 1
  for (const h of file.hunks) {
    max = Math.max(
      max,
      h.deletionStart + h.deletionCount - 1,
      h.additionStart + h.additionCount - 1
    )
  }
  return Math.max(2, String(max).length)
}
