import type { BoxRenderable, MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useCallback, useRef } from 'react'

import type { BarSide } from '../../../state/types'

import { useAppStore } from '../../../state/app-store'
import { getBarWidth, visibleWidgets } from '../../../state/bars'
import { dispatchGlobal } from '../../../state/dispatch-ref'
import { useTheme } from '../../theme'
import { WIDGET_RENDERERS } from '../../widgets/registry'
import { buildBarContextMenu, buildWidgetContextMenu } from '../../widgets/widget-context-menu'
import { ContextMenuBox } from '../overlays/context-menu/context-menu-box'
import { BarFooter } from './bar-footer'

export interface BarBoundaryResizeInfo {
  containerStart: number
  index: number
  side: BarSide
  totalSize: number
}

interface BarProps {
  side: BarSide
  onResizeDrag?: (event: OtuiMouseEvent) => boolean
  onResizeDragEnd?: () => void
  onEdgeResizeStart?: (info: { initialWidth: number; screenStart: number; side: BarSide }) => void
  onBoundaryResizeStart?: (info: BarBoundaryResizeInfo) => void
}

const RESIZE_HANDLE = '─'

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
  const contentWidth = Math.max(1, width - 1)

  // Drag handle on the side facing the terminal.
  const edge = (
    <box width={1} flexShrink={0} backgroundColor={t.border} onMouseDown={handleEdgeMouseDown} />
  )

  const body = (
    <box ref={bodyRef} flexDirection="column" flexGrow={1} overflow="hidden">
      {visible.map((widget, index) => (
        <BarWidgetSlot
          key={widget.id}
          bodyRef={bodyRef}
          contentWidth={contentWidth}
          grow={widget.grow}
          handleColor={t.border}
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
      backgroundColor={t.background}
      gap={0}
      overflow="hidden"
      rightClickMenu={buildBarContextMenu(bars, side)}
      onMouseDown={handleMouseDown}
      onMouseDrag={handleMouseDrag}
      onMouseUp={handleMouseUp}
    >
      {side === 'right' ? edge : null}
      <box width={contentWidth} flexGrow={1} flexDirection="column" overflow="hidden">
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
  handleColor,
  index,
  isLast,
  onBoundaryResizeStart,
  side,
  widgetId,
}: {
  bodyRef: React.RefObject<BoxRenderable | null>
  contentWidth: number
  grow: number
  handleColor: string
  index: number
  isLast: boolean
  side: BarSide
  widgetId: string
  onBoundaryResizeStart?: (info: BarBoundaryResizeInfo) => void
}) {
  const bars = useAppStore((s) => s.bars)
  const render = WIDGET_RENDERERS[widgetId]

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
      {isLast ? null : (
        <box minHeight={1} flexShrink={0} onMouseDown={handleBoundaryMouseDown}>
          <text fg={handleColor} selectable={false}>
            {RESIZE_HANDLE.repeat(Math.max(1, contentWidth))}
          </text>
        </box>
      )}
    </>
  )
}
