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
import { useTheme } from '../../theme'
import { buildUnifiedRows, gutterWidth, type UnifiedRowOrHeader } from './build-rows'
import { FoldStrip } from './fold-strip'
import { tokenToSpan } from './highlight'

// Same cap as split-view — keeps the React child count bounded.
const LARGE_ROW_CAP = 5000

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

  const rows = useMemo(
    () => buildUnifiedRows(file, folds, contentWidth),
    [file, folds, contentWidth]
  )
  const gw = useMemo(() => gutterWidth(file), [file])
  const truncated = rows.length > LARGE_ROW_CAP
  const displayRows = truncated ? rows.slice(0, LARGE_ROW_CAP) : rows

  return (
    <scrollbox
      ref={scrollRef}
      flexGrow={1}
      scrollY
      viewportCulling
      contentOptions={{ flexDirection: 'column', gap: 0 }}
      onMouseScroll={handleScroll}
    >
      {displayRows.map((row, i) => (
        <UnifiedRowRender
          key={i}
          foldDispatch={foldDispatch}
          gw={gw}
          highlights={highlights}
          row={row}
        />
      ))}
      {truncated ? <TruncationNotice hidden={rows.length - displayRows.length} /> : null}
    </scrollbox>
  )
})

function TruncationNotice({ hidden }: { hidden: number }) {
  const theme = useTheme()
  return (
    <box
      flexDirection="row"
      backgroundColor={theme.colors['sideBarSectionHeader.background']}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={theme.colors['editorWarning.foreground']}>
        …diff truncated — {hidden} more rows hidden
      </text>
    </box>
  )
}

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
  const theme = useTheme()
  if (row.type === 'hunk-header') {
    return (
      <box
        flexDirection="row"
        backgroundColor={theme.colors['sideBarSectionHeader.background']}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={theme.colors['descriptionForeground']}>{row.spec}</text>
        {row.context ? (
          <text fg={theme.colors['editor.lineHighlightBackground']}> {row.context}</text>
        ) : null}
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
        <text
          fg={theme.colors['descriptionForeground']}
        >{` ${pad(row.delLineNumber)} ${pad(row.addLineNumber)} `}</text>
        <text fg={theme.colors['editor.foreground']}> </text>
        <LineContent content={row.content} tokens={tokens} />
      </box>
    )
  }
  const bg =
    row.type === 'addition'
      ? theme.colors['diffEditor.insertedLineBackground']
      : theme.colors['diffEditor.removedLineBackground']
  const sign = row.type === 'addition' ? '+' : '-'
  const signColor =
    row.type === 'addition'
      ? theme.colors['gitDecoration.addedResourceForeground']
      : theme.colors['editorError.foreground']
  const delNum = row.type === 'deletion' ? row.lineNumber : undefined
  const addNum = row.type === 'addition' ? row.lineNumber : undefined
  const tokens = row.type === 'addition' ? highlights.add[row.lineIdx] : highlights.del[row.lineIdx]
  return (
    <box flexDirection="row" backgroundColor={bg} height={row.height}>
      <text fg={theme.colors['descriptionForeground']}>{` ${pad(delNum)} ${pad(addNum)} `}</text>
      <text fg={signColor}>{`${sign} `}</text>
      <LineContent content={row.content} tokens={tokens} />
    </box>
  )
}

function LineContent({ content, tokens }: { content: string; tokens: ThemedToken[] | undefined }) {
  const theme = useTheme()
  if (!tokens || tokens.length === 0) {
    return <text fg={theme.colors['editor.foreground']}>{content}</text>
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
          <span key={i} fg={s.fg ?? theme.colors['editor.foreground']} attributes={attributes}>
            {s.text}
          </span>
        )
      })}
    </text>
  )
}
