import type { MouseEvent as OtuiMouseEvent, ScrollBoxRenderable } from '@opentui/core'

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
import { type DiffScrollSlot, useDiffScroll } from '../../../git-view-controls'
import { useTheme } from '../../../theme'
import {
  type DiffSegment,
  estimatedSegmentHeight,
  expandUnifiedSegment,
  gutterWidth,
  type UnifiedRowOrHeader,
} from './build-rows'
import { FoldStrip } from './fold-strip'
import { LineContent } from './line-content'
import { useSegmentVirtualization } from './use-segment-virtualization'

const OVERSCAN = 24
const COLUMN_CONTENT_OPTIONS = { flexDirection: 'column' as const, gap: 0 }

// Stable per-row key derived from the line identities in the row, so rows keep a
// consistent identity across fold expand/collapse rather than relying on position.
function unifiedRowKey(row: UnifiedRowOrHeader): string {
  switch (row.type) {
    case 'hunk-header':
      return `hh:${row.spec}`
    case 'fold':
      return `f:${row.fold.foldId}`
    case 'context':
      return `c:${row.delLineNumber}:${row.addLineNumber}`
    case 'addition':
      return `a:${row.lineNumber}`
    case 'deletion':
      return `d:${row.lineNumber}`
  }
}

export interface StackedViewHandle {
  scroll: ScrollBoxRenderable | null
}

interface Props {
  file: FileDiffMetadata
  highlights: DiffHighlights
  foldDispatch: FoldDispatch
  /** Reports the text columns a line really has, once laid out. */
  onMeasure: (width: number) => void
  requestSegmentHighlights: (segments: readonly DiffSegment[]) => void
  segments: DiffSegment[]
  /** A file read as it is: one line number, no sign column. */
  single?: boolean
  width: number
}

interface RenderedSegment {
  exactHeight: number
  rows: UnifiedRowOrHeader[]
  segment: DiffSegment
}

function useWheel(): (e: OtuiMouseEvent) => void {
  const slot: DiffScrollSlot = useDiffScroll()
  return useCallback(
    (e: OtuiMouseEvent) => {
      const delta = getScrollViewportDelta(e)
      if (delta === null) return
      e.preventDefault()
      e.stopPropagation()
      slot.scroll(delta)
    },
    [slot]
  )
}

export const StackedView = forwardRef<StackedViewHandle, Props>(function StackedView(
  {
    file,
    foldDispatch,
    highlights,
    onMeasure,
    requestSegmentHighlights,
    segments,
    single = false,
    width,
  },
  ref
) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const measuredHeightsRef = useRef<Record<string, number>>({})
  const handleScroll = useWheel()
  const commitFrameRef = useRef(0)
  const [measurementVersion, setMeasurementVersion] = useState(0)

  useImperativeHandle(
    ref,
    () => ({
      get scroll() {
        return scrollRef.current
      },
    }),
    []
  )

  useEffect(() => {
    cancelAnimationFrame(commitFrameRef.current)
    if (Object.keys(measuredHeightsRef.current).length === 0) return
    measuredHeightsRef.current = {}
    setMeasurementVersion((version) => version + 1)
  }, [width, file])

  useEffect(() => {
    return () => cancelAnimationFrame(commitFrameRef.current)
  }, [])

  const estimateHeight = useCallback(
    (segment: DiffSegment) =>
      measuredHeightsRef.current[segment.id] ?? estimatedSegmentHeight(segment, 'stacked'),
    []
  )

  const visibleWindow = useSegmentVirtualization({
    estimateHeight,
    overscan: OVERSCAN,
    scrollRef,
    segments,
    version: measurementVersion,
  })

  const renderedSegments = useMemo<RenderedSegment[]>(() => {
    return visibleWindow.visible.map((segment) => {
      const rows = expandUnifiedSegment(file, segment, width)
      return {
        exactHeight: rows.reduce(
          (sum, row) => sum + (row.type === 'hunk-header' || row.type === 'fold' ? 1 : row.height),
          0
        ),
        rows,
        segment,
      }
    })
  }, [width, file, visibleWindow.visible])

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

  // Read off the laid-out viewport, not worked out from the screen. Two line
  // numbers and a sign come first: ` 12 34 ` and `+ ` — one number, ` 12 `,
  // for a file read as it is.
  const prefix = single ? gw + 2 : gw * 2 + 5
  const measure = useCallback(() => {
    const viewport = scrollRef.current?.viewport.width ?? 0
    if (viewport <= 0) return
    onMeasure(Math.max(1, viewport - prefix))
  }, [prefix, onMeasure])

  return (
    <scrollbox
      ref={scrollRef}
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
          <UnifiedRowRender
            key={`${rendered.segment.id}:${unifiedRowKey(row)}`}
            foldDispatch={foldDispatch}
            gw={gw}
            highlights={highlights}
            row={row}
            single={single}
            textWidth={width}
          />
        ))
      )}
      {visibleWindow.bottomSpacer > 0 ? <box height={visibleWindow.bottomSpacer} /> : null}
    </scrollbox>
  )
})

function UnifiedRowRender({
  foldDispatch,
  gw,
  highlights,
  row,
  single,
  textWidth,
}: {
  foldDispatch: FoldDispatch
  gw: number
  highlights: DiffHighlights
  row: UnifiedRowOrHeader
  single: boolean
  textWidth: number
}) {
  const t = useTheme()
  const headerBg = t.diffContextBg
  if (row.type === 'hunk-header') {
    return (
      <box flexDirection="row" backgroundColor={headerBg} paddingLeft={1} paddingRight={1}>
        <text fg={t.text}>{row.spec}</text>
        {row.context != null && row.context !== '' ? (
          <text fg={t.textMuted}> {row.context}</text>
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
    if (single) {
      return (
        <box flexDirection="row" height={row.height}>
          <text flexShrink={0} fg={t.textMuted}>{` ${pad(row.addLineNumber)} `}</text>
          <LineContent content={row.content} tokens={tokens} width={textWidth} />
        </box>
      )
    }
    return (
      <box flexDirection="row" height={row.height}>
        <text
          flexShrink={0}
          fg={t.textMuted}
        >{` ${pad(row.delLineNumber)} ${pad(row.addLineNumber)} `}</text>
        <text flexShrink={0} fg={t.text}>
          {'  '}
        </text>
        <LineContent content={row.content} tokens={tokens} width={textWidth} />
      </box>
    )
  }
  const bg = row.type === 'addition' ? t.diffAddedBg : t.diffRemovedBg
  const sign = row.type === 'addition' ? '+' : '-'
  const signColor = row.type === 'addition' ? t.diffAdded : t.diffRemoved
  const delNum = row.type === 'deletion' ? row.lineNumber : undefined
  const addNum = row.type === 'addition' ? row.lineNumber : undefined
  const tokens = row.type === 'addition' ? highlights.add[row.lineIdx] : highlights.del[row.lineIdx]
  return (
    <box flexDirection="row" backgroundColor={bg} height={row.height}>
      <text flexShrink={0} fg={t.textMuted}>{` ${pad(delNum)} ${pad(addNum)} `}</text>
      <text flexShrink={0} fg={signColor}>{`${sign} `}</text>
      <LineContent content={row.content} tokens={tokens} width={textWidth} />
    </box>
  )
}
