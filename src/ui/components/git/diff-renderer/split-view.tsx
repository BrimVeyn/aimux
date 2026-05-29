import type { ThemedToken } from 'shiki'

import {
  type MouseEvent as OtuiMouseEvent,
  type ScrollBoxRenderable,
  TextAttributes,
} from '@opentui/core'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { FileDiffMetadata } from '../../../../diff-parser'
import type { DiffHighlights, FoldDispatch } from './pierre-diff'

import { getScrollViewportDelta } from '../../../../app-runtime/terminal-mouse-adapter'
import { scrollGitDiff } from '../../../git-view-controls'
import { useTheme, useTransparent } from '../../../theme'
import {
  type DiffSegment,
  estimatedSegmentHeight,
  expandSplitSegment,
  gutterWidth,
  type SplitCell,
  type SplitRowOrHeader,
} from './build-rows'
import { FoldStrip } from './fold-strip'
import { tokenToSpan } from './highlight'
import { useSegmentVirtualization } from './use-segment-virtualization'

const OVERSCAN = 24
const COLUMN_CONTENT_OPTIONS = { flexDirection: 'column' as const, gap: 0 }
const HIDDEN_SCROLLBAR_OPTIONS = { visible: false }

// Stable per-row key derived from the line identities in the row, so rows keep a
// consistent identity across fold expand/collapse rather than relying on position.
function splitCellKey(cell: SplitCell): string {
  switch (cell.type) {
    case 'context':
      return `c${cell.lineNumber}`
    case 'addition':
      return `a${cell.lineNumber}`
    case 'deletion':
      return `d${cell.lineNumber}`
    case 'fold':
      return `f${cell.fold.foldId}`
    case 'filler':
      return 'x'
  }
}

function splitRowKey(row: SplitRowOrHeader): string {
  if (row.type === 'hunk-header') return `hh:${row.spec}`
  return `${splitCellKey(row.left)}|${splitCellKey(row.right)}`
}

export interface SplitViewHandle {
  leftScroll: ScrollBoxRenderable | null
  rightScroll: ScrollBoxRenderable | null
}

interface Props {
  file: FileDiffMetadata
  highlights: DiffHighlights
  foldDispatch: FoldDispatch
  contentWidth: number
  requestSegmentHighlights: (segments: readonly DiffSegment[]) => void
  segments: DiffSegment[]
}

interface RenderedSegment {
  exactHeight: number
  rows: SplitRowOrHeader[]
  segment: DiffSegment
}

function handleScroll(e: OtuiMouseEvent): void {
  const delta = getScrollViewportDelta(e)
  if (delta === null) return
  e.preventDefault()
  e.stopPropagation()
  scrollGitDiff(delta)
}

export const SplitView = forwardRef<SplitViewHandle, Props>(function SplitView(
  { contentWidth, file, foldDispatch, highlights, requestSegmentHighlights, segments },
  ref
) {
  const t = useTheme()
  const separatorBg = t.background
  const leftRef = useRef<ScrollBoxRenderable | null>(null)
  const rightRef = useRef<ScrollBoxRenderable | null>(null)
  const measuredHeightsRef = useRef<Record<string, number>>({})
  const commitFrameRef = useRef(0)
  const [measurementVersion, setMeasurementVersion] = useState(0)

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

  useEffect(() => {
    cancelAnimationFrame(commitFrameRef.current)
    if (Object.keys(measuredHeightsRef.current).length === 0) return
    measuredHeightsRef.current = {}
    setMeasurementVersion((version) => version + 1)
  }, [contentWidth, file])

  useEffect(() => {
    return () => cancelAnimationFrame(commitFrameRef.current)
  }, [])

  const estimateHeight = useCallback(
    (segment: DiffSegment) =>
      measuredHeightsRef.current[segment.id] ?? estimatedSegmentHeight(segment, 'split'),
    []
  )

  const visibleWindow = useSegmentVirtualization({
    estimateHeight,
    overscan: OVERSCAN,
    scrollRef: leftRef,
    segments,
    version: measurementVersion,
  })

  const renderedSegments = useMemo<RenderedSegment[]>(() => {
    return visibleWindow.visible.map((segment) => {
      const rows = expandSplitSegment(file, segment, contentWidth)
      return {
        exactHeight: rows.reduce((sum, row) => sum + (row.type === 'row' ? row.height : 1), 0),
        rows,
        segment,
      }
    })
  }, [contentWidth, file, visibleWindow.visible])

  useEffect(() => {
    requestSegmentHighlights(visibleWindow.visible)
  }, [requestSegmentHighlights, visibleWindow.visible])

  useEffect(() => {
    if (renderedSegments.length === 0) return
    let changed = false
    const next = { ...measuredHeightsRef.current }
    for (const rendered of renderedSegments) {
      if (next[rendered.segment.id] === rendered.exactHeight) continue
      next[rendered.segment.id] = rendered.exactHeight
      changed = true
    }
    if (!changed) return
    measuredHeightsRef.current = next
    cancelAnimationFrame(commitFrameRef.current)
    commitFrameRef.current = requestAnimationFrame(() => {
      setMeasurementVersion((version) => version + 1)
    })
  }, [renderedSegments])

  const gw = useMemo(() => gutterWidth(file), [file])

  return (
    <box flexDirection="row" flexGrow={1} overflow="hidden" onMouseScroll={handleScroll}>
      <scrollbox
        ref={leftRef}
        flexGrow={1}
        scrollY
        viewportCulling
        contentOptions={COLUMN_CONTENT_OPTIONS}
        verticalScrollbarOptions={HIDDEN_SCROLLBAR_OPTIONS}
        onMouseScroll={handleScroll}
      >
        {visibleWindow.topSpacer > 0 ? <box height={visibleWindow.topSpacer} /> : null}
        {renderedSegments.map((rendered) =>
          rendered.rows.map((row) => (
            <SideRow
              key={`${rendered.segment.id}:left:${splitRowKey(row)}`}
              cell={row.type === 'row' ? row.left : null}
              foldDispatch={foldDispatch}
              gw={gw}
              header={row.type === 'hunk-header' ? row : null}
              rowHeight={row.type === 'row' ? row.height : 1}
              tokens={highlights.del}
            />
          ))
        )}
        {visibleWindow.bottomSpacer > 0 ? <box height={visibleWindow.bottomSpacer} /> : null}
      </scrollbox>
      <box width={1} backgroundColor={separatorBg} />
      <scrollbox
        ref={rightRef}
        flexGrow={1}
        scrollY
        viewportCulling
        contentOptions={COLUMN_CONTENT_OPTIONS}
        onMouseScroll={handleScroll}
      >
        {visibleWindow.topSpacer > 0 ? <box height={visibleWindow.topSpacer} /> : null}
        {renderedSegments.map((rendered) =>
          rendered.rows.map((row) => (
            <SideRow
              key={`${rendered.segment.id}:right:${splitRowKey(row)}`}
              cell={row.type === 'row' ? row.right : null}
              foldDispatch={foldDispatch}
              gw={gw}
              header={row.type === 'hunk-header' ? row : null}
              rowHeight={row.type === 'row' ? row.height : 1}
              tokens={highlights.add}
            />
          ))
        )}
        {visibleWindow.bottomSpacer > 0 ? <box height={visibleWindow.bottomSpacer} /> : null}
      </scrollbox>
    </box>
  )
})

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
  const t = useTheme()
  const headerBg = t.diffContextBg
  return (
    <box flexDirection="row" backgroundColor={headerBg} paddingLeft={1} paddingRight={1}>
      <text fg={t.text}>{row.spec}</text>
      {row.context != null && row.context !== '' ? (
        <text fg={t.textMuted}> {row.context}</text>
      ) : null}
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
  const t = useTheme()
  const headerBg = t.diffContextBg
  const transparent = useTransparent()
  if (cell.type === 'filler') {
    return <box backgroundColor={headerBg} height={height} />
  }
  let bg: string | undefined
  let sign = ' '
  let signColor = t.textMuted
  if (cell.type === 'addition') {
    bg = t.diffAddedBg
    sign = '+'
    signColor = t.diffAdded
  } else if (cell.type === 'deletion') {
    bg = t.diffRemovedBg
    sign = '-'
    signColor = t.diffRemoved
  }
  const num = String(cell.lineNumber).padStart(gw, ' ')
  const lineTokens = tokens[cell.lineIdx]
  return (
    <box flexDirection="row" backgroundColor={transparent ? undefined : bg} height={height}>
      <text fg={t.textMuted}>{` ${num} `}</text>
      <text fg={signColor}>{`${sign} `}</text>
      <LineContent content={cell.content} tokens={lineTokens} />
    </box>
  )
}

function LineContent({ content, tokens }: { content: string; tokens: ThemedToken[] | undefined }) {
  const t = useTheme()
  if (!tokens || tokens.length === 0) {
    return <text fg={t.text}>{content}</text>
  }
  return (
    <text>
      {tokens.map((tok, i) => {
        const s = tokenToSpan(tok)
        let attributes = 0
        if (s.bold === true) attributes |= TextAttributes.BOLD
        if (s.italic === true) attributes |= TextAttributes.ITALIC
        if (s.underline === true) attributes |= TextAttributes.UNDERLINE
        return (
          // Syntax tokens are positional within a single line and never reorder.
          // eslint-disable-next-line react/no-array-index-key
          <span key={i} fg={s.fg ?? t.text} attributes={attributes}>
            {s.text}
          </span>
        )
      })}
    </text>
  )
}
