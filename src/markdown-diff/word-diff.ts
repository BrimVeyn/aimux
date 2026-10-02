import type { Span, SpanStyle } from './units'

import { lcsDiff } from './lcs'

export type PieceOp = 'add' | 'del' | 'same'

export interface Piece {
  op: PieceOp
  style: SpanStyle
  text: string
}

// Words, runs of whitespace, and single punctuation marks: an edit that adds a
// comma highlights the comma, not the word it hangs off.
const PIECE = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu

function cut(spans: readonly Span[]): Piece[] {
  const out: Piece[] = []
  for (const span of spans) {
    for (const match of span.text.matchAll(PIECE)) {
      out.push({ op: 'same', style: span.style, text: match[0] })
    }
  }
  return out
}

function styleKey(p: Piece): string {
  return `${JSON.stringify(p.style)}${p.text}`
}

/**
 * The two versions of a run of text as one sequence of pieces, each marked as
 * kept, removed or added. A word whose styling changed (made bold, say) counts
 * as removed and re-added. Whitespace-only changes are folded back to kept.
 */
export function diffSpans(before: readonly Span[], after: readonly Span[]): Piece[] {
  const out: Piece[] = []
  for (const op of lcsDiff(cut(before), cut(after), styleKey)) {
    if (op.type === 'same') out.push({ ...op.b, op: 'same' })
    else if (op.type === 'del') out.push({ ...op.a, op: 'del' })
    else out.push({ ...op.b, op: 'add' })
  }
  return out
}

/** One side of a diff: what that side shows, with its own changes marked. */
export function sideOf(pieces: readonly Piece[], side: 'new' | 'old'): Piece[] {
  const drop: PieceOp = side === 'old' ? 'add' : 'del'
  return pieces.filter((p) => p.op !== drop)
}

/** Line-level edit script for code blocks. */
export function diffLines(
  before: readonly string[],
  after: readonly string[]
): { op: PieceOp; text: string }[] {
  return lcsDiff(before, after, (l) => l).map((op) => {
    if (op.type === 'same') return { op: 'same', text: op.b }
    if (op.type === 'del') return { op: 'del', text: op.a }
    return { op: 'add', text: op.b }
  })
}
