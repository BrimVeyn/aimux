import type { FileDiffMetadata, HunkContent } from '../../../../diff-parser'
import type { FoldState } from '../../../../state/types'

export const KEEP_CONTEXT = 3
export const MIN_FOLD_SIZE = 3
export const FOLD_STEP = 5
export const CONTEXT_SEGMENT_CHUNK_LINES = 64
export const CHANGE_SEGMENT_CHUNK_LINES = 64

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
  height: number
}

export type UnifiedRow =
  | {
      addLineNumber: number
      content: string
      lineIdx: number
      delLineNumber: number
      type: 'context'
      height: number
    }
  | {
      content: string
      lineIdx: number
      lineNumber: number
      type: 'addition' | 'deletion'
      height: number
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
  leadingVisible: number
  fold: { length: number; offset: number } | null
  trailingVisible: number
}

interface SegmentBase {
  estimatedHeight: number
  id: string
  offset: number
}

export interface HunkHeaderSegment extends SegmentBase {
  kind: 'hunk-header'
  context?: string
  spec: string
}

export interface FoldSegment extends SegmentBase {
  kind: 'fold'
  fold: FoldInfo
}

export interface ContextSegment extends SegmentBase {
  kind: 'context'
  addLineNumberStart: number
  addStart: number
  count: number
  delLineNumberStart: number
  delStart: number
}

export interface ChangeSegment extends SegmentBase {
  kind: 'change'
  addLineNumberStart: number
  addStart: number
  additions: number
  delLineNumberStart: number
  delStart: number
  deletions: number
}

export type DiffSegment = HunkHeaderSegment | FoldSegment | ContextSegment | ChangeSegment

export interface DiffSegmentBuild {
  firstChangeOffset: number
  segments: DiffSegment[]
}

function wrapCount(content: string, width: number): number {
  if (width <= 0) return 1
  return Math.max(1, Math.ceil(content.length / width))
}

function cellWraps(content: string, width: number): number {
  return wrapCount(content, width)
}

function pairHeight(l: SplitCell, r: SplitCell, contentWidth: number): number {
  const lh =
    l.type === 'context' || l.type === 'addition' || l.type === 'deletion'
      ? cellWraps(l.content, contentWidth)
      : 1
  const rh =
    r.type === 'context' || r.type === 'addition' || r.type === 'deletion'
      ? cellWraps(r.content, contentWidth)
      : 1
  return Math.max(lh, rh)
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

export interface Foldable {
  foldId: string
  middle: number
}

export function collectFoldables(file: FileDiffMetadata): Foldable[] {
  const result: Foldable[] = []
  for (const [hIdx, hunk] of file.hunks.entries()) {
    for (const [cIdx, content] of hunk.hunkContent.entries()) {
      if (content.type !== 'context') continue
      const { hasChangeAfter, hasChangeBefore } = contextNeighbors(hunk.hunkContent, cIdx)
      const preKeep = hasChangeBefore ? Math.min(KEEP_CONTEXT, content.lines) : 0
      const postKeep = hasChangeAfter ? Math.min(KEEP_CONTEXT, content.lines - preKeep) : 0
      const middle = content.lines - preKeep - postKeep
      if (middle < MIN_FOLD_SIZE) continue
      result.push({ foldId: `${hIdx}:${cIdx}`, middle })
    }
  }
  return result
}

export function buildDiffSegments(file: FileDiffMetadata, folds: FoldMap = {}): DiffSegmentBuild {
  const segments: DiffSegment[] = []
  let offset = 0
  let firstChangeOffset = -1
  for (const [hIdx, hunk] of file.hunks.entries()) {
    segments.push({
      context: hunk.hunkContext,
      estimatedHeight: 1,
      id: `${hIdx}:header`,
      kind: 'hunk-header',
      offset,
      spec: `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`,
    })
    offset += 1
    let delLine = hunk.deletionStart
    let addLine = hunk.additionStart
    for (const [cIdx, content] of hunk.hunkContent.entries()) {
      if (content.type === 'context') {
        const foldId = `${hIdx}:${cIdx}`
        const { hasChangeAfter, hasChangeBefore } = contextNeighbors(hunk.hunkContent, cIdx)
        const foldState = folds[foldId] ?? { bottom: 0, top: 0 }
        const slice = sliceContext(content.lines, hasChangeBefore, hasChangeAfter, foldState)
        if (slice.leadingVisible > 0) {
          let consumed = 0
          while (consumed < slice.leadingVisible) {
            const count = Math.min(CONTEXT_SEGMENT_CHUNK_LINES, slice.leadingVisible - consumed)
            segments.push({
              addLineNumberStart: addLine + consumed,
              addStart: content.additionLineIndex + consumed,
              count,
              delLineNumberStart: delLine + consumed,
              delStart: content.deletionLineIndex + consumed,
              estimatedHeight: count,
              id: `${hIdx}:${cIdx}:context:${consumed}:${count}`,
              kind: 'context',
              offset: offset + consumed,
            })
            consumed += count
          }
          addLine += slice.leadingVisible
          delLine += slice.leadingVisible
          offset += slice.leadingVisible
        }
        if (slice.fold) {
          const preKeep = hasChangeBefore ? Math.min(KEEP_CONTEXT, content.lines) : 0
          const postKeep = hasChangeAfter ? Math.min(KEEP_CONTEXT, content.lines - preKeep) : 0
          const middle = content.lines - preKeep - postKeep
          const info = makeFoldInfo(foldId, middle, foldState, slice.fold.length)
          segments.push({
            estimatedHeight: 1,
            fold: info,
            id: `${hIdx}:${cIdx}:fold`,
            kind: 'fold',
            offset,
          })
          addLine += slice.fold.length
          delLine += slice.fold.length
          offset += 1
          if (slice.trailingVisible > 0) {
            const start = slice.fold.offset + slice.fold.length
            let consumed = 0
            while (consumed < slice.trailingVisible) {
              const count = Math.min(CONTEXT_SEGMENT_CHUNK_LINES, slice.trailingVisible - consumed)
              segments.push({
                addLineNumberStart: addLine + consumed,
                addStart: content.additionLineIndex + start + consumed,
                count,
                delLineNumberStart: delLine + consumed,
                delStart: content.deletionLineIndex + start + consumed,
                estimatedHeight: count,
                id: `${hIdx}:${cIdx}:context:${start + consumed}:${count}`,
                kind: 'context',
                offset: offset + consumed,
              })
              consumed += count
            }
            addLine += slice.trailingVisible
            delLine += slice.trailingVisible
            offset += slice.trailingVisible
          }
        }
      } else {
        const totalHeight = Math.max(content.additions, content.deletions)
        if (firstChangeOffset < 0) firstChangeOffset = offset
        let consumedHeight = 0
        let chunkIdx = 0
        while (consumedHeight < totalHeight) {
          const take = Math.min(CHANGE_SEGMENT_CHUNK_LINES, totalHeight - consumedHeight)
          const chunkAdditions = Math.min(take, Math.max(0, content.additions - consumedHeight))
          const chunkDeletions = Math.min(take, Math.max(0, content.deletions - consumedHeight))
          segments.push({
            additions: chunkAdditions,
            addLineNumberStart: addLine + consumedHeight,
            addStart: content.additionLineIndex + consumedHeight,
            deletions: chunkDeletions,
            delLineNumberStart: delLine + consumedHeight,
            delStart: content.deletionLineIndex + consumedHeight,
            estimatedHeight: take,
            id: `${hIdx}:${cIdx}:change:${chunkIdx}`,
            kind: 'change',
            offset: offset + consumedHeight,
          })
          consumedHeight += take
          chunkIdx += 1
        }
        addLine += content.additions
        delLine += content.deletions
        offset += totalHeight
      }
    }
  }
  return { firstChangeOffset, segments }
}

export function expandSplitSegment(
  file: FileDiffMetadata,
  segment: DiffSegment,
  contentWidth = 0
): SplitRowOrHeader[] {
  if (segment.kind === 'hunk-header') {
    return [{ context: segment.context, spec: segment.spec, type: 'hunk-header' }]
  }
  if (segment.kind === 'fold') {
    return [
      {
        height: 1,
        left: { fold: segment.fold, type: 'fold' },
        right: { fold: segment.fold, type: 'fold' },
        type: 'row',
      },
    ]
  }
  if (segment.kind === 'context') {
    const rows: SplitRowOrHeader[] = []
    for (let i = 0; i < segment.count; i++) {
      const addIdx = segment.addStart + i
      const delIdx = segment.delStart + i
      const text = stripNewline(file.additionLines[addIdx] ?? '')
      const left: SplitCell = {
        content: text,
        lineIdx: delIdx,
        lineNumber: segment.delLineNumberStart + i,
        type: 'context',
      }
      const right: SplitCell = {
        content: text,
        lineIdx: addIdx,
        lineNumber: segment.addLineNumberStart + i,
        type: 'context',
      }
      rows.push({ height: pairHeight(left, right, contentWidth), left, right, type: 'row' })
    }
    return rows
  }
  const rows: SplitRowOrHeader[] = []
  const max = Math.max(segment.additions, segment.deletions)
  for (let i = 0; i < max; i++) {
    const delIdx = segment.delStart + i
    const addIdx = segment.addStart + i
    const left: SplitCell =
      i < segment.deletions
        ? {
            content: stripNewline(file.deletionLines[delIdx] ?? ''),
            lineIdx: delIdx,
            lineNumber: segment.delLineNumberStart + i,
            type: 'deletion',
          }
        : { type: 'filler' }
    const right: SplitCell =
      i < segment.additions
        ? {
            content: stripNewline(file.additionLines[addIdx] ?? ''),
            lineIdx: addIdx,
            lineNumber: segment.addLineNumberStart + i,
            type: 'addition',
          }
        : { type: 'filler' }
    rows.push({ height: pairHeight(left, right, contentWidth), left, right, type: 'row' })
  }
  return rows
}

export function expandUnifiedSegment(
  file: FileDiffMetadata,
  segment: DiffSegment,
  contentWidth = 0
): UnifiedRowOrHeader[] {
  if (segment.kind === 'hunk-header') {
    return [{ context: segment.context, spec: segment.spec, type: 'hunk-header' }]
  }
  if (segment.kind === 'fold') return [{ fold: segment.fold, type: 'fold' }]
  if (segment.kind === 'context') {
    const rows: UnifiedRowOrHeader[] = []
    for (let i = 0; i < segment.count; i++) {
      const addIdx = segment.addStart + i
      const text = stripNewline(file.additionLines[addIdx] ?? '')
      rows.push({
        addLineNumber: segment.addLineNumberStart + i,
        content: text,
        delLineNumber: segment.delLineNumberStart + i,
        height: cellWraps(text, contentWidth),
        lineIdx: addIdx,
        type: 'context',
      })
    }
    return rows
  }
  const rows: UnifiedRowOrHeader[] = []
  for (let i = 0; i < segment.deletions; i++) {
    const delIdx = segment.delStart + i
    const text = stripNewline(file.deletionLines[delIdx] ?? '')
    rows.push({
      content: text,
      height: cellWraps(text, contentWidth),
      lineIdx: delIdx,
      lineNumber: segment.delLineNumberStart + i,
      type: 'deletion',
    })
  }
  for (let i = 0; i < segment.additions; i++) {
    const addIdx = segment.addStart + i
    const text = stripNewline(file.additionLines[addIdx] ?? '')
    rows.push({
      content: text,
      height: cellWraps(text, contentWidth),
      lineIdx: addIdx,
      lineNumber: segment.addLineNumberStart + i,
      type: 'addition',
    })
  }
  return rows
}

function rowHeight(row: SplitRowOrHeader | UnifiedRowOrHeader): number {
  if (row.type === 'hunk-header') return 1
  if (row.type === 'row') return row.height
  if (row.type === 'fold') return 1
  return row.height
}

function stripNewline(s: string): string {
  if (s.endsWith('\r\n')) return s.slice(0, -2)
  if (s.endsWith('\n')) return s.slice(0, -1)
  return s
}

export function estimatedSegmentHeight(segment: DiffSegment, view: 'split' | 'stacked'): number {
  if (segment.kind === 'hunk-header' || segment.kind === 'fold') return 1
  if (segment.kind === 'context') return segment.count
  return view === 'split'
    ? Math.max(segment.additions, segment.deletions)
    : segment.additions + segment.deletions
}

export function firstChangeSegmentOffset(
  file: FileDiffMetadata,
  folds: FoldMap,
  contentWidth: number,
  view: 'split' | 'stacked'
): number {
  const { segments } = buildDiffSegments(file, folds)
  let offset = 0
  for (const segment of segments) {
    if (segment.kind === 'change') return offset
    const rows =
      view === 'split'
        ? expandSplitSegment(file, segment, contentWidth)
        : expandUnifiedSegment(file, segment, contentWidth)
    for (const row of rows) offset += rowHeight(row)
  }
  return -1
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
