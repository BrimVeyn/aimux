import type { FileDiffMetadata } from '../../../../diff-parser'

import {
  type DiffSegment,
  expandSplitSegment,
  expandUnifiedSegment,
  rowHeight,
  type SplitWidths,
} from './build-rows'

/**
 * One run of removed and added lines with no unchanged line inside it — what a
 * reviewer reads as "a change". Git's own hunks are useless here: the diff is
 * taken with the whole file as context, so a file is always a single hunk.
 */
export interface ChangeBlock {
  /** `${hunk}:${content}`, the prefix of the block's segment ids. */
  id: string
  additions: number
  addIdx: number
  /** 1-based line number of the first added line, or where it would be. */
  addLine: number
  deletions: number
  delIdx: number
  delLine: number
}

export function changeBlocks(file: FileDiffMetadata): ChangeBlock[] {
  const out: ChangeBlock[] = []
  for (const [hIdx, hunk] of file.hunks.entries()) {
    let addLine = hunk.additionStart
    let delLine = hunk.deletionStart
    for (const [cIdx, content] of hunk.hunkContent.entries()) {
      if (content.type === 'context') {
        addLine += content.lines
        delLine += content.lines
        continue
      }
      out.push({
        addIdx: content.additionLineIndex,
        additions: content.additions,
        addLine,
        deletions: content.deletions,
        delIdx: content.deletionLineIndex,
        delLine,
        id: `${hIdx}:${cIdx}`,
      })
      addLine += content.additions
      delLine += content.deletions
    }
  }
  return out
}

/**
 * Row offset at which each change block starts, in block order — the same rows
 * the view scrolls through, so a block's offset is a `scrollTop`.
 */
export function changeBlockOffsets(
  file: FileDiffMetadata,
  segments: readonly DiffSegment[],
  widths: SplitWidths,
  view: 'split' | 'stacked'
): number[] {
  const out: number[] = []
  let offset = 0
  for (const segment of segments) {
    if (segment.kind === 'change' && segment.id.endsWith(':change:0')) out.push(offset)
    const rows =
      view === 'split'
        ? expandSplitSegment(file, segment, widths)
        : expandUnifiedSegment(file, segment, widths.left)
    for (const row of rows) offset += rowHeight(row)
  }
  return out
}

function stripNewline(s: string): string {
  if (s.endsWith('\r\n')) return s.slice(0, -2)
  if (s.endsWith('\n')) return s.slice(0, -1)
  return s
}

function lineRange(start: number, count: number): string {
  return count <= 1 ? `${start}` : `${start}-${start + count - 1}`
}

/**
 * The block as a reviewer would paste it into a prompt: where it is, then the
 * lines in a diff fence. The location names the new lines, or the old ones when
 * nothing was added, so "fix this" has something to point at either way.
 */
export function formatChangeBlock(
  file: FileDiffMetadata,
  block: ChangeBlock,
  path: string
): string {
  const lines: string[] = []
  for (let i = 0; i < block.deletions; i++) {
    lines.push(`-${stripNewline(file.deletionLines[block.delIdx + i] ?? '')}`)
  }
  for (let i = 0; i < block.additions; i++) {
    lines.push(`+${stripNewline(file.additionLines[block.addIdx + i] ?? '')}`)
  }
  const where =
    block.additions > 0
      ? `${path}:${lineRange(block.addLine, block.additions)}`
      : `${path}:${lineRange(block.delLine, block.deletions)} (deleted)`
  const body = lines.join('\n')
  let fence = '```'
  while (body.includes(fence)) fence += '`'
  return `${where}\n${fence}diff\n${body}\n${fence}\n`
}
