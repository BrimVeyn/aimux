import type { BoxRenderable, MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useCallback, useRef } from 'react'

import type { BarSide } from '../../../state/types'

import { useAppStore } from '../../../state/app-store'
import { getBarWidth, visibleWidgets } from '../../../state/bars'
import { dispatchGlobal } from '../../../state/dispatch-ref'
import { useTheme } from '../../theme'
import { getWidgetRenderer } from '../../widgets/registry'
import { buildBarContextMenu, buildWidgetContextMenu } from '../../widgets/widget-context-menu'
import { ContextMenuBox } from '../overlays/context-menu/context-menu-box'
import { BarFooter } from './bar-footer'

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
  // space, both cells start a resize. Painted with the bar, not in the page
  // colour: a page-coloured strip here left a seam between the bar and the tab
  // bar above it, which are the same panel. What separates the bar from the
  // terminal is the terminal's own background, nothing drawn.
  const edge = (
    <box
      width={GUTTER}
      flexShrink={0}
      backgroundColor={t.backgroundPanel}
      onMouseDown={handleEdgeMouseDown}
    />
  )

  const body = (
    <box ref={bodyRef} flexDirection="column" flexGrow={1} overflow="hidden">
      {visible.map((widget, index) => (
        <BarWidgetSlot
          key={widget.id}
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
      flexDirection="row"
      backgroundColor={t.backgroundPanel}
      gap={0}
      overflow="hidden"
      rightClickMenu={buildBarContextMenu(bars, side)}
      onMouseDown={handleMouseDown}
      onMouseDrag={handleMouseDrag}
      onMouseUp={handleMouseUp}
    >
      {side === 'right' ? edge : null}
      {/* The bar is one surface, top to bottom: widgets, the gaps between them,
          the footer and the gutter all share it, and it runs straight into the
          tab bar above. Painting each widget separately left the gaps and the
          footer showing the page colour through, which read as seams. */}
      <box
        width={contentWidth}
        flexGrow={1}
        flexDirection="column"
        overflow="hidden"
        backgroundColor={t.backgroundPanel}
      >
        {body}
        {side === 'left' ? <BarFooter contentWidth={contentWidth} /> : null}
      </box>
      {side === 'left' ? edge : null}
    </ContextMenuBox>
  )
}

function BarWidgetSlot({
  bodyRef,
  contentWidth,
  grow,
  index,
  isLast,
  onBoundaryResizeStart,
  side,
  widgetId,
}: {
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
        rightClickMenu={buildWidgetContextMenu(bars, side, widgetId)}
      >
        {render(contentWidth)}
      </ContextMenuBox>
      {/* The boundary between two widgets: a blank grabbable row, no rule drawn
          in it. Widgets read as separate because of the gap, the same way
          opencode separates its surfaces. */}
      {isLast ? null : (
        <box
          minHeight={1}
          width={contentWidth}
          flexShrink={0}
          onMouseDown={handleBoundaryMouseDown}
        />
      )}
    </>
  )
}
