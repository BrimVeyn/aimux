import type { FileDiffMetadata, Hunk } from '../../../diff-parser'

export type SplitCell =
  | { content: string; lineNumber: number; type: 'context' }
  | { content: string; lineNumber: number; type: 'addition' | 'deletion' }
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
      delLineNumber: number
      type: 'context'
    }
  | {
      content: string
      lineNumber: number
      type: 'addition' | 'deletion'
    }

export interface HunkHeader {
  context?: string
  spec: string
  type: 'hunk-header'
}

export type SplitRowOrHeader = HunkHeader | SplitRow
export type UnifiedRowOrHeader = HunkHeader | UnifiedRow

export function buildSplitRows(file: FileDiffMetadata): SplitRowOrHeader[] {
  const rows: SplitRowOrHeader[] = []
  for (const hunk of file.hunks) {
    rows.push(makeHeader(hunk))
    let delLine = hunk.deletionStart
    let addLine = hunk.additionStart
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        for (let i = 0; i < content.lines; i++) {
          const text = file.additionLines[content.additionLineIndex + i] ?? ''
          rows.push({
            left: { content: stripNewline(text), lineNumber: delLine++, type: 'context' },
            right: { content: stripNewline(text), lineNumber: addLine++, type: 'context' },
            type: 'row',
          })
        }
      } else {
        const max = Math.max(content.additions, content.deletions)
        for (let i = 0; i < max; i++) {
          const left: SplitCell =
            i < content.deletions
              ? {
                  content: stripNewline(file.deletionLines[content.deletionLineIndex + i] ?? ''),
                  lineNumber: delLine++,
                  type: 'deletion',
                }
              : { type: 'filler' }
          const right: SplitCell =
            i < content.additions
              ? {
                  content: stripNewline(file.additionLines[content.additionLineIndex + i] ?? ''),
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

export function buildUnifiedRows(file: FileDiffMetadata): UnifiedRowOrHeader[] {
  const rows: UnifiedRowOrHeader[] = []
  for (const hunk of file.hunks) {
    rows.push(makeHeader(hunk))
    let delLine = hunk.deletionStart
    let addLine = hunk.additionStart
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        for (let i = 0; i < content.lines; i++) {
          const text = file.additionLines[content.additionLineIndex + i] ?? ''
          rows.push({
            addLineNumber: addLine++,
            content: stripNewline(text),
            delLineNumber: delLine++,
            type: 'context',
          })
        }
      } else {
        for (let i = 0; i < content.deletions; i++) {
          rows.push({
            content: stripNewline(file.deletionLines[content.deletionLineIndex + i] ?? ''),
            lineNumber: delLine++,
            type: 'deletion',
          })
        }
        for (let i = 0; i < content.additions; i++) {
          rows.push({
            content: stripNewline(file.additionLines[content.additionLineIndex + i] ?? ''),
            lineNumber: addLine++,
            type: 'addition',
          })
        }
      }
    }
  }
  return rows
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
