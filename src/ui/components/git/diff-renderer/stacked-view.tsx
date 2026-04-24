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
import { usePalette, useTheme, useTransparent } from '../../../theme'
import {
  type DiffSegment,
  estimatedSegmentHeight,
  expandUnifiedSegment,
  gutterWidth,
  type UnifiedRowOrHeader,
} from './build-rows'
import { FoldStrip } from './fold-strip'
import { tokenToSpan } from './highlight'
import { useSegmentVirtualization } from './use-segment-virtualization'

const OVERSCAN = 24

export interface StackedViewHandle {
  scroll: ScrollBoxRenderable | null
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
  rows: UnifiedRowOrHeader[]
  segment: DiffSegment
}

function handleScroll(e: OtuiMouseEvent): void {
  const delta = getScrollViewportDelta(e)
  if (delta === null) return
  e.preventDefault()
  e.stopPropagation()
  scrollGitDiff(delta)
}

export const StackedView = forwardRef<StackedViewHandle, Props>(function StackedView(
  { contentWidth, file, foldDispatch, highlights, requestSegmentHighlights, segments },
  ref
) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const measuredHeightsRef = useRef<Record<string, number>>({})
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
  }, [contentWidth, file])

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
      const rows = expandUnifiedSegment(file, segment, contentWidth)
      return {
        exactHeight: rows.reduce(
          (sum, row) => sum + (row.type === 'hunk-header' || row.type === 'fold' ? 1 : row.height),
          0
        ),
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
    <scrollbox
      ref={scrollRef}
      flexGrow={1}
      scrollY
      viewportCulling
      contentOptions={{ flexDirection: 'column', gap: 0 }}
      onMouseScroll={handleScroll}
    >
      {visibleWindow.topSpacer > 0 ? <box height={visibleWindow.topSpacer} /> : null}
      {renderedSegments.map((rendered) =>
        rendered.rows.map((row, i) => (
          <UnifiedRowRender
            key={`${rendered.segment.id}:${i}`}
            foldDispatch={foldDispatch}
            gw={gw}
            highlights={highlights}
            row={row}
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
}: {
  foldDispatch: FoldDispatch
  gw: number
  highlights: DiffHighlights
  row: UnifiedRowOrHeader
}) {
  const t = useTheme()
  const p = usePalette()
  const headerBg = t['surface-weak']
  const transparent = useTransparent()
  if (row.type === 'hunk-header') {
    return (
      <box flexDirection="row" backgroundColor={headerBg} paddingLeft={1} paddingRight={1}>
        <text fg={p.primary}>{row.spec}</text>
        {row.context ? <text fg={t['text-weaker']}> {row.context}</text> : null}
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
        <text fg={t['text-weaker']}>{` ${pad(row.delLineNumber)} ${pad(row.addLineNumber)} `}</text>
        <text fg={t['text-base']}> </text>
        <LineContent content={row.content} tokens={tokens} />
      </box>
    )
  }
  const bg = row.type === 'addition' ? t['surface-diff-add-weak'] : t['surface-diff-delete-weak']
  const sign = row.type === 'addition' ? '+' : '-'
  const signColor = row.type === 'addition' ? p.success : p.error
  const delNum = row.type === 'deletion' ? row.lineNumber : undefined
  const addNum = row.type === 'addition' ? row.lineNumber : undefined
  const tokens = row.type === 'addition' ? highlights.add[row.lineIdx] : highlights.del[row.lineIdx]
  return (
    <box flexDirection="row" backgroundColor={transparent ? undefined : bg} height={row.height}>
      <text fg={t['text-weaker']}>{` ${pad(delNum)} ${pad(addNum)} `}</text>
      <text fg={signColor}>{`${sign} `}</text>
      <LineContent content={row.content} tokens={tokens} />
    </box>
  )
}

function LineContent({ content, tokens }: { content: string; tokens: ThemedToken[] | undefined }) {
  const t = useTheme()
  if (!tokens || tokens.length === 0) {
    return <text fg={t['text-base']}>{content}</text>
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
          <span key={i} fg={s.fg ?? t['text-base']} attributes={attributes}>
            {s.text}
          </span>
        )
      })}
    </text>
  )
}
