import type { ThemedToken } from 'shiki'

import {
  type MouseEvent as OtuiMouseEvent,
  type ScrollBoxRenderable,
  TextAttributes,
} from '@opentui/core'
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'

import type { FileDiffMetadata } from '../../../diff-parser'
import type { FoldState } from '../../../state/types'
import type { DiffHighlights, FoldDispatch } from './pierre-diff'

import { getScrollViewportDelta } from '../../../app-runtime/terminal-mouse-adapter'
import { scrollGitDiff } from '../../git-view-controls'
import { useBg, useTokens, useTransparent } from '../../theme'
import { buildSplitRows, gutterWidth, type SplitCell, type SplitRowOrHeader } from './build-rows'
import { FoldStrip } from './fold-strip'
import { tokenToSpan } from './highlight'

const LARGE_ROW_CAP = 5000

export interface SplitViewHandle {
  leftScroll: ScrollBoxRenderable | null
  rightScroll: ScrollBoxRenderable | null
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

export const SplitView = forwardRef<SplitViewHandle, Props>(function SplitView(
  { contentWidth, file, foldDispatch, folds, highlights },
  ref
) {
  const separatorBg = useBg('base')
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

  const rows = useMemo(() => buildSplitRows(file, folds, contentWidth), [file, folds, contentWidth])
  const gw = useMemo(() => gutterWidth(file), [file])
  const truncated = rows.length > LARGE_ROW_CAP
  const displayRows = truncated ? rows.slice(0, LARGE_ROW_CAP) : rows

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
        {displayRows.map((row, i) => (
          <SideRow
            key={i}
            cell={row.type === 'row' ? row.left : null}
            foldDispatch={foldDispatch}
            gw={gw}
            header={row.type === 'hunk-header' ? row : null}
            rowHeight={row.type === 'row' ? row.height : 1}
            tokens={highlights.del}
          />
        ))}
        {truncated ? <TruncationNotice hidden={rows.length - displayRows.length} /> : null}
      </scrollbox>
      <box width={1} backgroundColor={separatorBg} />
      <scrollbox
        ref={rightRef}
        flexGrow={1}
        scrollY
        viewportCulling
        contentOptions={{ flexDirection: 'column', gap: 0 }}
        onMouseScroll={handleScroll}
      >
        {displayRows.map((row, i) => (
          <SideRow
            key={i}
            cell={row.type === 'row' ? row.right : null}
            foldDispatch={foldDispatch}
            gw={gw}
            header={row.type === 'hunk-header' ? row : null}
            rowHeight={row.type === 'row' ? row.height : 1}
            tokens={highlights.add}
          />
        ))}
        {truncated ? <TruncationNotice hidden={rows.length - displayRows.length} /> : null}
      </scrollbox>
    </box>
  )
})

function TruncationNotice({ hidden }: { hidden: number }) {
  const t = useTokens()
  const headerBg = useBg('elevated')
  return (
    <box flexDirection="row" backgroundColor={headerBg} paddingLeft={1} paddingRight={1}>
      <text fg={t.palette.warning}>…diff truncated — {hidden} more rows hidden</text>
    </box>
  )
}

function SideRow({
  cell,
  foldDispatch,
  gw,
  header,
  rowHeight,
  tokens,
}: {
  cell: SplitCell | null
  foldDispatch: FoldDispatch
  gw: number
  header: Extract<SplitRowOrHeader, { type: 'hunk-header' }> | null
  rowHeight: number
  tokens: ThemedToken[][]
}) {
  if (header) return <HunkHeaderRow row={header} />
  if (!cell) return null
  if (cell.type === 'fold') return <FoldStrip dispatch={foldDispatch} fold={cell.fold} />
  return <HalfRow cell={cell} gw={gw} height={rowHeight} tokens={tokens} />
}

function HunkHeaderRow({ row }: { row: Extract<SplitRowOrHeader, { type: 'hunk-header' }> }) {
  const t = useTokens()
  const headerBg = useBg('elevated')
  return (
    <box flexDirection="row" backgroundColor={headerBg} paddingLeft={1} paddingRight={1}>
      <text fg={t.muted}>{row.spec}</text>
      {row.context ? <text fg={t.hover}> {row.context}</text> : null}
    </box>
  )
}

function HalfRow({
  cell,
  gw,
  height,
  tokens,
}: {
  cell: Exclude<SplitCell, { type: 'fold' }>
  gw: number
  height: number
  tokens: ThemedToken[][]
}) {
  const t = useTokens()
  const headerBg = useBg('elevated')
  const transparent = useTransparent()
  if (cell.type === 'filler') {
    return <box backgroundColor={headerBg} height={height} />
  }
  let bg: string | undefined
  let sign = ' '
  let signColor = t.muted
  if (cell.type === 'addition') {
    bg = t.diffAddBg
    sign = '+'
    signColor = t.palette.success
  } else if (cell.type === 'deletion') {
    bg = t.diffDeleteBg
    sign = '-'
    signColor = t.palette.error
  }
  const num = String(cell.lineNumber).padStart(gw, ' ')
  const lineTokens = tokens[cell.lineIdx]
  return (
    <box flexDirection="row" backgroundColor={transparent ? undefined : bg} height={height}>
      <text fg={t.muted}>{` ${num} `}</text>
      <text fg={signColor}>{`${sign} `}</text>
      <LineContent content={cell.content} tokens={lineTokens} />
    </box>
  )
}

function LineContent({ content, tokens }: { content: string; tokens: ThemedToken[] | undefined }) {
  const t = useTokens()
  if (!tokens || tokens.length === 0) {
    return <text fg={t.palette.ink}>{content}</text>
  }
  return (
    <text>
      {tokens.map((tok, i) => {
        const s = tokenToSpan(tok)
        let attributes = 0
        if (s.bold) attributes |= TextAttributes.BOLD
        if (s.italic) attributes |= TextAttributes.ITALIC
        if (s.underline) attributes |= TextAttributes.UNDERLINE
        return (
          <span key={i} fg={s.fg ?? t.palette.ink} attributes={attributes}>
            {s.text}
          </span>
        )
      })}
    </text>
  )
}
