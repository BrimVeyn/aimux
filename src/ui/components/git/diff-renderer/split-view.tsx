import type { MouseEvent as OtuiMouseEvent, ScrollBoxRenderable } from '@opentui/core'
import type { ThemedToken } from 'shiki'

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
import { useTheme } from '../../../theme'
import {
  type DiffSegment,
  estimatedSegmentHeight,
  expandSplitSegment,
  gutterWidth,
  type SplitCell,
  type SplitRowOrHeader,
  type SplitWidths,
} from './build-rows'
import { FoldStrip } from './fold-strip'
import { LineContent } from './line-content'
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
  /** Reports the text columns each side really has, once laid out. */
  onMeasure: (widths: SplitWidths) => void
  requestSegmentHighlights: (segments: readonly DiffSegment[]) => void
  segments: DiffSegment[]
  widths: SplitWidths
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
  { file, foldDispatch, highlights, onMeasure, requestSegmentHighlights, segments, widths },
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
  }, [widths, file])

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
      const rows = expandSplitSegment(file, segment, widths)
      return {
        exactHeight: rows.reduce((sum, row) => sum + (row.type === 'row' ? row.height : 1), 0),
        rows,
        segment,
      }
    })
  }, [widths, file, visibleWindow.visible])

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

  // Read off the laid-out viewports rather than worked out from the screen: the
  // two sides need not be equal (only one shows a scrollbar), and nothing upstream
  // knows how wide the file list beside them is. ` 123 ` and `+ ` come first.
  const measure = useCallback(() => {
    const prefix = gw + 4
    const left = leftRef.current?.viewport.width ?? 0
    const right = rightRef.current?.viewport.width ?? 0
    if (left <= 0 || right <= 0) return
    onMeasure({ left: Math.max(1, left - prefix), right: Math.max(1, right - prefix) })
  }, [gw, onMeasure])

  return (
    <box flexDirection="row" flexGrow={1} overflow="hidden" onMouseScroll={handleScroll}>
      <scrollbox
        ref={leftRef}
        flexGrow={1}
        renderAfter={measure}
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
              textWidth={widths.left}
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
        renderAfter={measure}
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
              textWidth={widths.right}
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
  textWidth,
  tokens,
}: {
  cell: SplitCell | null
  foldDispatch: FoldDispatch
  gw: number
  header: Extract<SplitRowOrHeader, { type: 'hunk-header' }> | null
  rowHeight: number
  textWidth: number
  tokens: ThemedToken[][]
}) {
  if (header) return <HunkHeaderRow row={header} />
  if (!cell) return null
  if (cell.type === 'fold') return <FoldStrip dispatch={foldDispatch} fold={cell.fold} />
  return <HalfRow cell={cell} gw={gw} height={rowHeight} textWidth={textWidth} tokens={tokens} />
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
  textWidth,
  tokens,
}: {
  cell: Exclude<SplitCell, { type: 'fold' }>
  gw: number
  height: number
  textWidth: number
  tokens: ThemedToken[][]
}) {
  const t = useTheme()
  const headerBg = t.diffContextBg
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
    <box flexDirection="row" backgroundColor={bg} height={height}>
      <text flexShrink={0} fg={t.textMuted}>{` ${num} `}</text>
      <text flexShrink={0} fg={signColor}>{`${sign} `}</text>
      <LineContent content={cell.content} tokens={lineTokens} width={textWidth} />
    </box>
  )
}
