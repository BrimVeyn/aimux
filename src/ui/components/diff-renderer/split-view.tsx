import type { ThemedToken } from 'shiki'

import { type ScrollBoxRenderable, TextAttributes } from '@opentui/core'
import { forwardRef, useImperativeHandle, useRef } from 'react'

import type { FileDiffMetadata } from '../../../diff-parser'
import type { DiffHighlights } from './pierre-diff'

import { theme } from '../../theme'
import { buildSplitRows, gutterWidth, type SplitCell, type SplitRowOrHeader } from './build-rows'
import { tokenToSpan } from './highlight'

export interface SplitViewHandle {
  leftScroll: ScrollBoxRenderable | null
  rightScroll: ScrollBoxRenderable | null
}

interface Props {
  file: FileDiffMetadata
  highlights: DiffHighlights
}

export const SplitView = forwardRef<SplitViewHandle, Props>(function SplitView(
  { file, highlights },
  ref
) {
  const leftRef = useRef<ScrollBoxRenderable | null>(null)
  const rightRef = useRef<ScrollBoxRenderable | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      get leftScroll() {
        return leftRef.current
      },
      get rightScroll() {
        return rightRef.current
      },
    }),
    []
  )

  const rows = buildSplitRows(file)
  const gw = gutterWidth(file)

  return (
    <box flexDirection="row" flexGrow={1} overflow="hidden">
      <scrollbox
        ref={leftRef}
        flexGrow={1}
        scrollY
        viewportCulling
        contentOptions={{ flexDirection: 'column', gap: 0 }}
      >
        {rows.map((row, i) =>
          row.type === 'hunk-header' ? (
            <HunkHeaderRow key={i} row={row} />
          ) : (
            <HalfRow key={i} cell={row.left} gw={gw} tokens={highlights.del} />
          )
        )}
      </scrollbox>
      <box width={1} backgroundColor={theme.dim} />
      <scrollbox
        ref={rightRef}
        flexGrow={1}
        scrollY
        viewportCulling
        contentOptions={{ flexDirection: 'column', gap: 0 }}
      >
        {rows.map((row, i) =>
          row.type === 'hunk-header' ? (
            <HunkHeaderRow key={i} row={row} />
          ) : (
            <HalfRow key={i} cell={row.right} gw={gw} tokens={highlights.add} />
          )
        )}
      </scrollbox>
    </box>
  )
})

function HunkHeaderRow({ row }: { row: Extract<SplitRowOrHeader, { type: 'hunk-header' }> }) {
  return (
    <box flexDirection="row" backgroundColor={theme.panelMuted} paddingLeft={1} paddingRight={1}>
      <text fg={theme.textMuted}>{row.spec}</text>
      {row.context ? <text fg={theme.dim}> {row.context}</text> : null}
    </box>
  )
}

function HalfRow({ cell, gw, tokens }: { cell: SplitCell; gw: number; tokens: ThemedToken[][] }) {
  if (cell.type === 'filler') {
    return <box backgroundColor={theme.panelMuted} height={1} />
  }
  let bg: string | undefined
  let sign = ' '
  let signColor = theme.textMuted
  if (cell.type === 'addition') {
    bg = theme.diffAddBg
    sign = '+'
    signColor = theme.success
  } else if (cell.type === 'deletion') {
    bg = theme.diffRemoveBg
    sign = '-'
    signColor = theme.danger
  }
  const num = String(cell.lineNumber).padStart(gw, ' ')
  const lineTokens = tokens[cell.lineIdx]
  return (
    <box flexDirection="row" backgroundColor={bg}>
      <text fg={theme.textMuted}>{` ${num} `}</text>
      <text fg={signColor}>{`${sign} `}</text>
      <LineContent content={cell.content} tokens={lineTokens} />
    </box>
  )
}

function LineContent({ content, tokens }: { content: string; tokens: ThemedToken[] | undefined }) {
  if (!tokens || tokens.length === 0) {
    return <text fg={theme.text}>{content}</text>
  }
  return (
    <text wrapMode="none">
      {tokens.map((t, i) => {
        const s = tokenToSpan(t)
        let attributes = 0
        if (s.bold) attributes |= TextAttributes.BOLD
        if (s.italic) attributes |= TextAttributes.ITALIC
        if (s.underline) attributes |= TextAttributes.UNDERLINE
        return (
          <span key={i} fg={s.fg ?? theme.text} attributes={attributes}>
            {s.text}
          </span>
        )
      })}
    </text>
  )
}
