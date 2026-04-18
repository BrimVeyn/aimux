import type { ThemedToken } from 'shiki'

import {
  type MouseEvent as OtuiMouseEvent,
  type ScrollBoxRenderable,
  TextAttributes,
} from '@opentui/core'
import { forwardRef, useImperativeHandle, useRef } from 'react'

import type { FileDiffMetadata } from '../../../diff-parser'
import type { FoldState } from '../../../state/types'
import type { DiffHighlights, FoldDispatch } from './pierre-diff'

import { getScrollViewportDelta } from '../../../app-runtime/terminal-mouse-adapter'
import { scrollGitDiff } from '../../git-view-controls'
import { theme } from '../../theme'
import { buildUnifiedRows, gutterWidth, type UnifiedRowOrHeader } from './build-rows'
import { FoldStrip } from './fold-strip'
import { tokenToSpan } from './highlight'

export interface StackedViewHandle {
  scroll: ScrollBoxRenderable | null
}

interface Props {
  file: FileDiffMetadata
  highlights: DiffHighlights
  folds: Record<string, FoldState>
  foldDispatch: FoldDispatch
  contentWidth: number
}

function handleScroll(e: OtuiMouseEvent): void {
  const delta = getScrollViewportDelta(e)
  if (delta === null) return
  e.preventDefault()
  e.stopPropagation()
  scrollGitDiff(delta)
}

export const StackedView = forwardRef<StackedViewHandle, Props>(function StackedView(
  { contentWidth, file, foldDispatch, folds, highlights },
  ref
) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      get scroll() {
        return scrollRef.current
      },
    }),
    []
  )

  const rows = buildUnifiedRows(file, folds, contentWidth)
  const gw = gutterWidth(file)

  return (
    <scrollbox
      ref={scrollRef}
      flexGrow={1}
      scrollY
      viewportCulling
      contentOptions={{ flexDirection: 'column', gap: 0 }}
      onMouseScroll={handleScroll}
    >
      {rows.map((row, i) => (
        <UnifiedRowRender
          key={i}
          foldDispatch={foldDispatch}
          gw={gw}
          highlights={highlights}
          row={row}
        />
      ))}
    </scrollbox>
  )
})

function UnifiedRowRender({
  foldDispatch,
  gw,
  highlights,
  row,
}: {
  foldDispatch: FoldDispatch
  gw: number
  highlights: DiffHighlights
  row: UnifiedRowOrHeader
}) {
  if (row.type === 'hunk-header') {
    return (
      <box flexDirection="row" backgroundColor={theme.panelMuted} paddingLeft={1} paddingRight={1}>
        <text fg={theme.textMuted}>{row.spec}</text>
        {row.context ? <text fg={theme.dim}> {row.context}</text> : null}
      </box>
    )
  }
  if (row.type === 'fold') {
    return <FoldStrip dispatch={foldDispatch} fold={row.fold} />
  }
  const pad = (n: number | undefined): string =>
    n === undefined ? ' '.repeat(gw) : String(n).padStart(gw, ' ')
  if (row.type === 'context') {
    const tokens = highlights.add[row.lineIdx]
    return (
      <box flexDirection="row" height={row.height}>
        <text fg={theme.textMuted}>{` ${pad(row.delLineNumber)} ${pad(row.addLineNumber)} `}</text>
        <text fg={theme.text}> </text>
        <LineContent content={row.content} tokens={tokens} />
      </box>
    )
  }
  const bg = row.type === 'addition' ? theme.diffAddBg : theme.diffRemoveBg
  const sign = row.type === 'addition' ? '+' : '-'
  const signColor = row.type === 'addition' ? theme.success : theme.danger
  const delNum = row.type === 'deletion' ? row.lineNumber : undefined
  const addNum = row.type === 'addition' ? row.lineNumber : undefined
  const tokens = row.type === 'addition' ? highlights.add[row.lineIdx] : highlights.del[row.lineIdx]
  return (
    <box flexDirection="row" backgroundColor={bg} height={row.height}>
      <text fg={theme.textMuted}>{` ${pad(delNum)} ${pad(addNum)} `}</text>
      <text fg={signColor}>{`${sign} `}</text>
      <LineContent content={row.content} tokens={tokens} />
    </box>
  )
}

function LineContent({ content, tokens }: { content: string; tokens: ThemedToken[] | undefined }) {
  if (!tokens || tokens.length === 0) {
    return <text fg={theme.text}>{content}</text>
  }
  return (
    <text>
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
