import type { ThemedToken } from 'shiki'

import type { FileDiffMetadata } from '../../../diff-parser'
import type { ChangeSegment, ContextSegment, DiffSegment } from './build-rows'

import { ensureActiveShikiTheme, ensureShikiLang, getShikiHighlighter } from '../../shiki'

export interface HighlightSpan {
  bold?: boolean
  fg?: string
  italic?: boolean
  text: string
  underline?: boolean
}

// Shiki FontStyle: 1 = italic, 2 = bold, 4 = underline.
export function tokenToSpan(token: ThemedToken): HighlightSpan {
  const fs = token.fontStyle ?? 0
  return {
    bold: (fs & 2) !== 0 || undefined,
    fg: token.color,
    italic: (fs & 1) !== 0 || undefined,
    text: token.content,
    underline: (fs & 4) !== 0 || undefined,
  }
}

export async function tokenizeSide(lines: string[], lang: string): Promise<ThemedToken[][]> {
  if (lines.length === 0) return []
  const highlighter = await getShikiHighlighter()
  const [langOk, themeName] = await Promise.all([
    ensureShikiLang(highlighter, lang),
    ensureActiveShikiTheme(highlighter),
  ])
  if (!langOk) return []
  try {
    const result = highlighter.codeToTokens(lines.join(''), {
      // eslint-disable-next-line typescript/no-explicit-any
      lang: lang as any,
      // eslint-disable-next-line typescript/no-explicit-any
      theme: themeName as any,
    })
    return result.tokens
  } catch {
    return []
  }
}

export interface HighlightPatch {
  start: number
  tokens: ThemedToken[][]
}

export interface SegmentHighlightPatches {
  add: HighlightPatch[]
  del: HighlightPatch[]
}

function range(lines: string[], start: number, count: number): string[] {
  return count > 0 ? lines.slice(start, start + count) : []
}

async function tokenizeContextSegment(
  file: FileDiffMetadata,
  segment: ContextSegment,
  lang: string
): Promise<SegmentHighlightPatches> {
  const tokens = await tokenizeSide(
    range(file.additionLines, segment.addStart, segment.count),
    lang
  )
  if (tokens.length === 0) return { add: [], del: [] }
  return {
    add: [{ start: segment.addStart, tokens }],
    del: [{ start: segment.delStart, tokens }],
  }
}

async function tokenizeChangeSegment(
  file: FileDiffMetadata,
  segment: ChangeSegment,
  lang: string
): Promise<SegmentHighlightPatches> {
  const [add, del] = await Promise.all([
    tokenizeSide(range(file.additionLines, segment.addStart, segment.additions), lang),
    tokenizeSide(range(file.deletionLines, segment.delStart, segment.deletions), lang),
  ])
  return {
    add: add.length > 0 ? [{ start: segment.addStart, tokens: add }] : [],
    del: del.length > 0 ? [{ start: segment.delStart, tokens: del }] : [],
  }
}

export async function tokenizeSegment(
  file: FileDiffMetadata,
  segment: DiffSegment,
  lang: string
): Promise<SegmentHighlightPatches> {
  if (segment.kind === 'context') return tokenizeContextSegment(file, segment, lang)
  if (segment.kind === 'change') return tokenizeChangeSegment(file, segment, lang)
  return { add: [], del: [] }
}
