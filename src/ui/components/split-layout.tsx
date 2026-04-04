import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import type { TerminalContentOrigin } from '../../input/raw-input-handler'
import type { FocusMode, TabSession } from '../../state/types'

import { logInputDebug } from '../../debug/input-log'
import {
  computePaneRects,
  type LayoutNode,
  PANE_BORDER,
  type PaneRect,
  type SplitDirection,
} from '../../state/layout-tree'
import { theme } from '../theme'
import { TerminalPane } from './terminal-pane'

const PANE_CHROME = PANE_BORDER

interface SplitLayoutProps {
  node: LayoutNode
  tabs: TabSession[]
  activeTabId: string | null
  focusMode: FocusMode
  mouseForwardingEnabled: boolean
  localScrollbackEnabled: boolean
  onTerminalMouseEvent: (event: OtuiMouseEvent, origin: TerminalContentOrigin) => void
  onTerminalScrollEvent: (event: OtuiMouseEvent) => void
  onTerminalClick?: (event: OtuiMouseEvent, origin: TerminalContentOrigin, tabId?: string) => void
  onPaneActivate?: (tabId: string) => void
  onSplitResize?: (tabId: string, ratio: number, axis: SplitDirection) => void
  onSeparatorDragStart?: (info: {
    tabId: string
    direction: SplitDirection
    screenStart: number
    totalSize: number
  }) => void
  onSeparatorDrag?: (event: OtuiMouseEvent) => boolean
  onSeparatorDragEnd?: () => void
  contentOrigin: TerminalContentOrigin
  bounds: PaneRect
}

export function SplitLayout({
  activeTabId,
  bounds,
  contentOrigin,
  focusMode,
  localScrollbackEnabled,
  mouseForwardingEnabled,
  node,
  onPaneActivate,
  onSeparatorDrag,
  onSeparatorDragEnd,
  onSeparatorDragStart,
  onSplitResize,
  onTerminalClick,
  onTerminalMouseEvent,
  onTerminalScrollEvent,
  tabs,
}: SplitLayoutProps) {
  if (node.type === 'leaf') {
    const tab = tabs.find((t) => t.id === node.tabId)
    const isActive = node.tabId === activeTabId
    const paneOrigin: TerminalContentOrigin = {
      cols: Math.max(1, bounds.cols - PANE_CHROME * 2),
      rows: Math.max(1, bounds.rows - PANE_CHROME * 2),
      x: contentOrigin.x + bounds.x + PANE_CHROME,
      y: contentOrigin.y + bounds.y + PANE_CHROME,
    }
    logInputDebug('split.paneOrigin', {
      boundsCols: bounds.cols,
      boundsRows: bounds.rows,
      boundsX: bounds.x,
      boundsY: bounds.y,
      contentOriginX: contentOrigin.x,
      contentOriginY: contentOrigin.y,
      paneChrome: PANE_CHROME,
      paneOriginX: paneOrigin.x,
      paneOriginY: paneOrigin.y,
      tabId: node.tabId,
    })
    return (
      <TerminalPane
        tab={tab}
        tabId={node.tabId}
        focusMode={focusMode}
        isActive={isActive}
        contentOrigin={paneOrigin}
        mouseForwardingEnabled={isActive && mouseForwardingEnabled}
        localScrollbackEnabled={isActive && localScrollbackEnabled}
        onTerminalMouseEvent={onTerminalMouseEvent}
        onTerminalScrollEvent={onTerminalScrollEvent}
        onTerminalClick={onTerminalClick}
        onPaneActivate={onPaneActivate}
        onSeparatorDrag={onSeparatorDrag}
        onSeparatorDragEnd={onSeparatorDragEnd}
      />
    )
  }

  const flexDir = node.direction === 'vertical' ? 'row' : 'column'
  const firstGrow = Math.round(node.ratio * 100)
  const secondGrow = 100 - firstGrow

  // Compute sub-bounds for each child
  const rects = computePaneRects(node, bounds)

  // Compute the bounding rect for each subtree
  const firstBounds = subtreeBounds(node.first, rects, bounds)
  const secondBounds = subtreeBounds(node.second, rects, bounds)

  return (
    <box flexDirection={flexDir} flexGrow={1} gap={0}>
      <box flexGrow={firstGrow} flexDirection="column" overflow="hidden">
        <SplitLayout
          node={node.first}
          tabs={tabs}
          activeTabId={activeTabId}
          focusMode={focusMode}
          mouseForwardingEnabled={mouseForwardingEnabled}
          localScrollbackEnabled={localScrollbackEnabled}
          onTerminalMouseEvent={onTerminalMouseEvent}
          onTerminalScrollEvent={onTerminalScrollEvent}
          onTerminalClick={onTerminalClick}
          onPaneActivate={onPaneActivate}
          onSplitResize={onSplitResize}
          onSeparatorDragStart={onSeparatorDragStart}
          onSeparatorDrag={onSeparatorDrag}
          onSeparatorDragEnd={onSeparatorDragEnd}
          contentOrigin={contentOrigin}
          bounds={firstBounds}
        />
      </box>
      <box
        minWidth={node.direction === 'vertical' ? 1 : undefined}
        minHeight={node.direction === 'horizontal' ? 1 : undefined}
        backgroundColor={theme.border}
        onMouseDown={(e: OtuiMouseEvent) => {
          e.preventDefault()
          if (!onSeparatorDragStart) return
          const leafId = getFirstLeafId(node.first)
          if (!leafId) return
          onSeparatorDragStart({
            direction: node.direction,
            screenStart:
              node.direction === 'vertical'
                ? contentOrigin.x + bounds.x
                : contentOrigin.y + bounds.y,
            tabId: leafId,
            totalSize: node.direction === 'vertical' ? bounds.cols : bounds.rows,
          })
        }}
      />
      <box flexGrow={secondGrow} flexDirection="column" overflow="hidden">
        <SplitLayout
          node={node.second}
          tabs={tabs}
          activeTabId={activeTabId}
          focusMode={focusMode}
          mouseForwardingEnabled={mouseForwardingEnabled}
          localScrollbackEnabled={localScrollbackEnabled}
          onTerminalMouseEvent={onTerminalMouseEvent}
          onTerminalScrollEvent={onTerminalScrollEvent}
          onTerminalClick={onTerminalClick}
          onPaneActivate={onPaneActivate}
          onSplitResize={onSplitResize}
          onSeparatorDragStart={onSeparatorDragStart}
          onSeparatorDrag={onSeparatorDrag}
          onSeparatorDragEnd={onSeparatorDragEnd}
          contentOrigin={contentOrigin}
          bounds={secondBounds}
        />
      </box>
    </box>
  )
}

function getFirstLeafId(node: LayoutNode): string | null {
  if (node.type === 'leaf') return node.tabId
  return getFirstLeafId(node.first)
}

function subtreeBounds(
  node: LayoutNode,
  rects: Map<string, PaneRect>,
  fallback: PaneRect
): PaneRect {
  if (node.type === 'leaf') {
    return rects.get(node.tabId) ?? fallback
  }
  const firstBounds = subtreeBounds(node.first, rects, fallback)
  const lastBounds = subtreeBounds(node.second, rects, fallback)
  const x = Math.min(firstBounds.x, lastBounds.x)
  const y = Math.min(firstBounds.y, lastBounds.y)
  return {
    cols: Math.max(firstBounds.x + firstBounds.cols, lastBounds.x + lastBounds.cols) - x,
    rows: Math.max(firstBounds.y + firstBounds.rows, lastBounds.y + lastBounds.rows) - y,
    x,
    y,
  }
}
