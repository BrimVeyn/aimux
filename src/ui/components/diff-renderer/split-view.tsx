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
import { buildSplitRows, gutterWidth, type SplitCell, type SplitRowOrHeader } from './build-rows'
import { FoldStrip } from './fold-strip'
import { tokenToSpan } from './highlight'

export interface SplitViewHandle {
  leftScroll: ScrollBoxRenderable | null
  rightScroll: ScrollBoxRenderable | null
}

interface Props {
  file: FileDiffMetadata
  highlights: DiffHighlights
  folds: Record<string, FoldState>
  foldDispatch: FoldDispatch
}

function handleScroll(e: OtuiMouseEvent): void {
  const delta = getScrollViewportDelta(e)
  if (delta === null) return
  e.preventDefault()
  e.stopPropagation()
  scrollGitDiff(delta)
}

export const SplitView = forwardRef<SplitViewHandle, Props>(function SplitView(
  { file, foldDispatch, folds, highlights },
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

  const rows = buildSplitRows(file, folds)
  const gw = gutterWidth(file)

  return (
    <box flexDirection="row" flexGrow={1} overflow="hidden" onMouseScroll={handleScroll}>
      <scrollbox
        ref={leftRef}
        flexGrow={1}
        scrollY
        viewportCulling
        contentOptions={{ flexDirection: 'column', gap: 0 }}
        verticalScrollbarOptions={{ visible: false }}
        onMouseScroll={handleScroll}
      >
        {rows.map((row, i) => (
          <SideRow
            key={i}
            cell={row.type === 'row' ? row.left : null}
            foldDispatch={foldDispatch}
            gw={gw}
            header={row.type === 'hunk-header' ? row : null}
            tokens={highlights.del}
          />
        ))}
      </scrollbox>
      <box width={1} backgroundColor={theme.dim} />
      <scrollbox
        ref={rightRef}
        flexGrow={1}
        scrollY
        viewportCulling
        contentOptions={{ flexDirection: 'column', gap: 0 }}
        onMouseScroll={handleScroll}
      >
        {rows.map((row, i) => (
          <SideRow
            key={i}
            cell={row.type === 'row' ? row.right : null}
            foldDispatch={foldDispatch}
            gw={gw}
            header={row.type === 'hunk-header' ? row : null}
            tokens={highlights.add}
          />
        ))}
      </scrollbox>
    </box>
  )
})

function SideRow({
  cell,
  foldDispatch,
  gw,
  header,
  tokens,
}: {
  cell: SplitCell | null
  foldDispatch: FoldDispatch
  gw: number
  header: Extract<SplitRowOrHeader, { type: 'hunk-header' }> | null
  tokens: ThemedToken[][]
}) {
  if (header) return <HunkHeaderRow row={header} />
  if (!cell) return null
  if (cell.type === 'fold') return <FoldStrip dispatch={foldDispatch} fold={cell.fold} />
  return <HalfRow cell={cell} gw={gw} tokens={tokens} />
}

function HunkHeaderRow({ row }: { row: Extract<SplitRowOrHeader, { type: 'hunk-header' }> }) {
  return (
    <box flexDirection="row" backgroundColor={theme.panelMuted} paddingLeft={1} paddingRight={1}>
      <text fg={theme.textMuted}>{row.spec}</text>
      {row.context ? <text fg={theme.dim}> {row.context}</text> : null}
    </box>
  )
}

function HalfRow({
  cell,
  gw,
  tokens,
}: {
  cell: Exclude<SplitCell, { type: 'fold' }>
  gw: number
  tokens: ThemedToken[][]
}) {
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
