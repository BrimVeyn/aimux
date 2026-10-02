import { TextAttributes } from '@opentui/core'
import { memo } from 'react'

import type { Piece, SpanStyle } from '../../../../markdown-diff'

import { useTheme } from '../../../theme'

function attributesOf(style: SpanStyle, base: number): number {
  let attributes = base
  if (style.strong) attributes |= TextAttributes.BOLD
  if (style.em) attributes |= TextAttributes.ITALIC
  if (style.del) attributes |= TextAttributes.STRIKETHROUGH
  if (style.link) attributes |= TextAttributes.UNDERLINE
  return attributes
}

interface InlineProps {
  /** Text attributes every piece starts from (a heading is bold, a quote italic). */
  attributes?: number
  fg: string
  pieces: readonly Piece[]
}

/**
 * A run of text as styled pieces. Markdown styling comes from the theme's
 * markdown tokens; a piece's diff op paints its background, and a removed piece
 * is also struck through, so the change still reads without colour.
 */
export const Inline = memo(function Inline({
  attributes: base = 0,
  fg: baseFg,
  pieces,
}: InlineProps) {
  const t = useTheme()
  return (
    <text fg={baseFg} wrapMode="word">
      {pieces.map((piece, i) => {
        let fg = baseFg
        if (piece.style.code) fg = t.markdownCode
        else if (piece.style.link) fg = t.markdownLink
        else if (piece.style.strong) fg = t.markdownStrong
        else if (piece.style.em) fg = t.markdownEmph
        let attributes = attributesOf(piece.style, base)
        let bg: string | undefined
        if (piece.op === 'add') bg = t.diffHighlightAdded
        if (piece.op === 'del') {
          bg = t.diffHighlightRemoved
          attributes |= TextAttributes.STRIKETHROUGH
        }
        return (
          // Pieces are positional within one block and never reorder.
          // eslint-disable-next-line react/no-array-index-key
          <span key={i} attributes={attributes} bg={bg} fg={fg}>
            {piece.text}
          </span>
        )
      })}
    </text>
  )
})
