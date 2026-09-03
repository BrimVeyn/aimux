import type { BoxRenderable, MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { BarSide } from '../../../state/types'

import { useAppStore } from '../../../state/app-store'
import { getBarWidth, visibleWidgets } from '../../../state/bars'
import { dispatchGlobal } from '../../../state/dispatch-ref'
import { useTheme, useTransparent } from '../../theme'
import { getWidgetRenderer } from '../../widgets/registry'
import { buildBarContextMenu, buildWidgetContextMenu } from '../../widgets/widget-context-menu'
import { ContextMenuBox } from '../overlays/context-menu/context-menu-box'
import { BarFooter } from './bar-footer'

/** Same settle delay as the pane measurement: one opentui layout tick. */
const WIDGET_SETTLE_DELAY_MS = 32

export interface BarBoundaryResizeInfo {
  containerStart: number
  index: number
  side: BarSide
  totalSize: number
}

/**
 * Columns between the widgets and the terminal: one to grab for a resize, one so
 * the content is not flush against the edge. Both grab.
 */
const GUTTER = 2

/** The rule drawn on the rows that separate the bar's regions. */
const BOUNDARY_RULE = '─'

/**
 * One row of rule, full bar width. Every seam in the bar is this, gutter
 * included: the widgets are inset from the terminal, the seams between them are
 * not. Only the seams between two widgets survive transparent mode — see `Bar`.
 */
function BarRule({ width }: { width: number }) {
  const t = useTheme()
  return (
    <text fg={t.border} selectable={false} wrapMode="none">
      {BOUNDARY_RULE.repeat(Math.max(1, width))}
    </text>
  )
}

interface BarProps {
  side: BarSide
  onResizeDrag?: (event: OtuiMouseEvent) => boolean
  onResizeDragEnd?: () => void
  onEdgeResizeStart?: (info: { initialWidth: number; screenStart: number; side: BarSide }) => void
  onBoundaryResizeStart?: (info: BarBoundaryResizeInfo) => void
}

/**
 * One edge bar hosting a vertical stack of widgets. Both bars are this
 * component; the only asymmetry is which side the resize handle sits on.
 */
export function Bar({
  onBoundaryResizeStart,
  onEdgeResizeStart,
  onResizeDrag,
  onResizeDragEnd,
  side,
}: BarProps) {
  const t = useTheme()
  // The seam above the widgets and the seam under the footer belong to no
  // widget — they are where the bar stops. Opaque, they are a rule on the bar's
  // own surface; transparent, there is nothing for a rule to sit on and nothing
  // to separate, so the surface is painted on the widget stack alone and the two
  // seams become the gap they were always describing.
  const transparent = useTransparent()
  const columnBg = transparent ? undefined : t.backgroundPanel
  const surfaceBg = transparent ? t.backgroundPanel : undefined
  const bars = useAppStore((s) => s.bars)
  const focusMode = useAppStore((s) => s.focusMode)
  const bodyRef = useRef<BoxRenderable | null>(null)

  const bar = bars[side]
  const width = getBarWidth(bar)

  const handleMouseDown = useCallback(() => {
    if (focusMode === 'terminal-input') {
      dispatchGlobal({ focusMode: 'navigation', type: 'set-focus-mode' })
    }
  }, [focusMode])
  const handleMouseDrag = useCallback(
    (event: OtuiMouseEvent) => {
      if (onResizeDrag?.(event) === true) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    [onResizeDrag]
  )
  const handleMouseUp = useCallback(() => {
    onResizeDragEnd?.()
  }, [onResizeDragEnd])
  const handleEdgeMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      onEdgeResizeStart?.({ initialWidth: width, screenStart: event.x, side })
    },
    [onEdgeResizeStart, side, width]
  )

  if (width === 0) return null

  const visible = visibleWidgets(bar)
  const contentWidth = Math.max(1, width - GUTTER)

  // The gutter on the side facing the terminal: the resize grip and the widgets'
  // inset from the terminal are the same two columns — the padding is not dead
  // space, both cells start a resize. Overlaid rather than sat in a column of
  // its own, and unpainted so the bar shows through it: the widget boundaries
  // run the full width of the bar, under it.
  const edge = (
    <box
      position="absolute"
      top={0}
      {...(side === 'left' ? { right: 0 } : { left: 0 })}
      width={GUTTER}
      height="100%"
      onMouseDown={handleEdgeMouseDown}
    />
  )

  const body = (
    <box
      ref={bodyRef}
      flexDirection="column"
      flexGrow={1}
      overflow="hidden"
      backgroundColor={surfaceBg}
    >
      {visible.map((widget, index) => (
        <BarWidgetSlot
          key={widget.id}
          barWidth={width}
          bodyRef={bodyRef}
          contentWidth={contentWidth}
          grow={widget.grow}
          index={index}
          isLast={index === visible.length - 1}
          onBoundaryResizeStart={onBoundaryResizeStart}
          side={side}
          widgetId={widget.id}
        />
      ))}
    </box>
  )

  return (
    <ContextMenuBox
      width={width}
      padding={0}
      flexDirection="column"
      backgroundColor={columnBg}
      gap={0}
      overflow="hidden"
      rightClickMenu={buildBarContextMenu(bars, side)}
      onMouseDown={handleMouseDown}
      onMouseDrag={handleMouseDrag}
      onMouseUp={handleMouseUp}
    >
      {/* The bar is one surface: widgets, the gaps between them, the footer and
          the gutter all share it. Painting each widget separately left the gaps
          and the footer showing the layer underneath, which read as seams. */}
      {/* Left only: this seam separates the widgets from the tab bar, which the
          left bar sits under and the right bar does not. */}
      {side === 'left' ? (
        <box flexShrink={0} minHeight={1}>
          {transparent ? null : <BarRule width={width} />}
        </box>
      ) : null}
      {body}
      {side === 'left' ? (
        <box flexShrink={0} flexDirection="column">
          <box paddingRight={GUTTER} backgroundColor={surfaceBg}>
            <BarFooter contentWidth={contentWidth} />
          </box>
          <box flexShrink={0} minHeight={1}>
            {transparent ? null : <BarRule width={width} />}
          </box>
        </box>
      ) : null}
      {edge}
    </ContextMenuBox>
  )
}

function BarWidgetSlot({
  barWidth,
  bodyRef,
  contentWidth,
  grow,
  index,
  isLast,
  onBoundaryResizeStart,
  side,
  widgetId,
}: {
  barWidth: number
  bodyRef: React.RefObject<BoxRenderable | null>
  contentWidth: number
  grow: number
  index: number
  isLast: boolean
  side: BarSide
  widgetId: string
  onBoundaryResizeStart?: (info: BarBoundaryResizeInfo) => void
}) {
  const bars = useAppStore((s) => s.bars)
  // Re-read on every registry change: a hot-reloaded plugin widget swaps its
  // renderer, and the registry is not part of the store.
  useAppStore((s) => s.pluginRegistryVersion)
  const render = getWidgetRenderer(widgetId)

  // How tall this slot actually came out. A widget knew its width and had to
  // guess its height, which is the difference between a sparkline that fills
  // its panel and one that draws six rows into a space that has four. Measured
  // rather than computed: the flex share is opentui's arithmetic, not ours.
  const [rows, setRows] = useState(0)
  const slotRef = useRef<BoxRenderable | null>(null)
  const measure = useCallback(() => {
    const box = slotRef.current
    if (!box) return
    const next = Math.round(box.height)
    if (next < 1) return
    setRows((prev) => (prev === next ? prev : next))
  }, [])
  // Twice, for the same reason `usePaneSizeReport` does: opentui settles layout
  // on its own tick after React commits, and a bar toggled on an idle screen
  // produces no second commit to observe it in.
  useEffect(() => {
    measure()
    const timer = setTimeout(measure, WIDGET_SETTLE_DELAY_MS)
    return () => {
      clearTimeout(timer)
    }
  })
  const attach = useCallback(
    (node: BoxRenderable | null) => {
      slotRef.current = node
      if (node) measure()
    },
    [measure]
  )

  const handleBoundaryMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      const body = bodyRef.current
      if (!body) return
      event.preventDefault()
      event.stopPropagation()
      onBoundaryResizeStart?.({
        containerStart: body.y,
        index,
        side,
        totalSize: Math.max(1, body.height),
      })
    },
    [bodyRef, index, onBoundaryResizeStart, side]
  )

  if (!render) return null

  return (
    <>
      <ContextMenuBox
        flexDirection="column"
        flexGrow={grow}
        flexShrink={1}
        flexBasis={0}
        overflow="hidden"
        ref={attach}
        {...(side === 'left' ? { paddingRight: GUTTER } : { paddingLeft: GUTTER })}
        rightClickMenu={buildWidgetContextMenu(bars, side, widgetId)}
      >
        {render(contentWidth, { cols: contentWidth, rows })}
      </ContextMenuBox>
      {/* Drawn, not blank: a grabbable row nobody can see is an affordance that
          does not exist. */}
      {isLast ? null : (
        <box minHeight={1} width={barWidth} flexShrink={0} onMouseDown={handleBoundaryMouseDown}>
          <BarRule width={barWidth} />
        </box>
      )}
    </>
  )
}
