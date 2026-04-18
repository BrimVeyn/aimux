import type { FileDiffMetadata, Hunk } from '../../../diff-parser'

export type SplitCell =
  | { content: string; lineIdx: number; lineNumber: number; type: 'context' }
  | { content: string; lineIdx: number; lineNumber: number; type: 'addition' | 'deletion' }
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

export interface HunkHeader {
  context?: string
  spec: string
  type: 'hunk-header'
  hunkIndex: number
  collapsed: boolean
}

export type SplitRowOrHeader = HunkHeader | SplitRow
export type UnifiedRowOrHeader = HunkHeader | UnifiedRow

export function buildSplitRows(
  file: FileDiffMetadata,
  collapsed: ReadonlySet<number> = new Set()
): SplitRowOrHeader[] {
  const rows: SplitRowOrHeader[] = []
  for (const [hIdx, hunk] of file.hunks.entries()) {
    const isCollapsed = collapsed.has(hIdx)
    rows.push(makeHeader(hunk, hIdx, isCollapsed))
    if (isCollapsed) continue
    let delLine = hunk.deletionStart
    let addLine = hunk.additionStart
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        for (let i = 0; i < content.lines; i++) {
          const addIdx = content.additionLineIndex + i
          const delIdx = content.deletionLineIndex + i
          const text = stripNewline(file.additionLines[addIdx] ?? '')
          rows.push({
            left: { content: text, lineIdx: delIdx, lineNumber: delLine++, type: 'context' },
            right: { content: text, lineIdx: addIdx, lineNumber: addLine++, type: 'context' },
            type: 'row',
          })
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
  collapsed: ReadonlySet<number> = new Set()
): UnifiedRowOrHeader[] {
  const rows: UnifiedRowOrHeader[] = []
  for (const [hIdx, hunk] of file.hunks.entries()) {
    const isCollapsed = collapsed.has(hIdx)
    rows.push(makeHeader(hunk, hIdx, isCollapsed))
    if (isCollapsed) continue
    let delLine = hunk.deletionStart
    let addLine = hunk.additionStart
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        for (let i = 0; i < content.lines; i++) {
          const addIdx = content.additionLineIndex + i
          const text = stripNewline(file.additionLines[addIdx] ?? '')
          rows.push({
            addLineNumber: addLine++,
            content: text,
            delLineNumber: delLine++,
            lineIdx: addIdx,
            type: 'context',
          })
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

function makeHeader(hunk: Hunk, hunkIndex: number, collapsed: boolean): HunkHeader {
  const spec = `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`
  return { collapsed, context: hunk.hunkContext, hunkIndex, spec, type: 'hunk-header' }
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
