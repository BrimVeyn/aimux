import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useMemo } from 'react'

import type { MeasuredPaneRect } from '../../../app-runtime/use-pane-size-report'
import type { TerminalContentOrigin } from '../../../input/raw-input-handler'
import type { FocusMode, TabSession } from '../../../state/types'

import { logInputDebug } from '../../../debug/input-log'
import {
  computeJunctionEdges,
  computePaneRects,
  type JunctionEdges,
  type LayoutNode,
  PANE_BORDER,
  type PaneRect,
  type SplitDirection,
} from '../../../state/layout-tree'
import { PluginPane } from './plugin-pane'
import { TerminalPane } from './terminal-pane'

const PANE_CHROME = PANE_BORDER

interface SplitLayoutProps {
  node: LayoutNode
  tabs: TabSession[]
  activeTabId: string | null
  /** The pane holding the keyboard, when it is not a terminal. */
  activePluginPaneId?: string | null
  focusMode: FocusMode
  mouseForwardingEnabled: boolean
  localScrollbackEnabled: boolean
  onTerminalMouseEvent: (event: OtuiMouseEvent, origin: TerminalContentOrigin) => void
  onTerminalScrollEvent: (event: OtuiMouseEvent) => void
  onTerminalClick?: (event: OtuiMouseEvent, origin: TerminalContentOrigin, tabId?: string) => void
  onTerminalDrag?: (event: OtuiMouseEvent, origin: TerminalContentOrigin, tabId?: string) => boolean
  onTerminalMouseUp?: (event: OtuiMouseEvent) => boolean
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
  onLeftEdgeMouseDown?: (event: OtuiMouseEvent) => boolean
  onMeasure?: (tabId: string, rect: MeasuredPaneRect) => void
  contentOrigin: TerminalContentOrigin
  bounds: PaneRect
  junctionEdgesMap?: Map<string, JunctionEdges>
}

export function SplitLayout({
  activePluginPaneId = null,
  activeTabId,
  bounds,
  contentOrigin,
  focusMode,
  junctionEdgesMap: providedJunctionEdgesMap,
  localScrollbackEnabled,
  mouseForwardingEnabled,
  node,
  onLeftEdgeMouseDown,
  onMeasure,
  onPaneActivate,
  onSeparatorDrag,
  onSeparatorDragEnd,
  onSeparatorDragStart,
  onSplitResize,
  onTerminalClick,
  onTerminalDrag,
  onTerminalMouseEvent,
  onTerminalMouseUp,
  onTerminalScrollEvent,
  tabs,
}: SplitLayoutProps) {
  const junctionEdgesMap = useMemo(
    () =>
      providedJunctionEdgesMap ??
      computeJunctionEdges(node, bounds, { x: contentOrigin.x, y: contentOrigin.y }),
    [providedJunctionEdgesMap, node, bounds, contentOrigin]
  )
  const paneOrigin = useMemo<TerminalContentOrigin>(
    () => ({
      cols: Math.max(1, bounds.cols - PANE_CHROME * 2),
      rows: Math.max(1, bounds.rows - PANE_CHROME * 2),
      x: contentOrigin.x + bounds.x + PANE_CHROME,
      y: contentOrigin.y + bounds.y + PANE_CHROME,
    }),
    [bounds, contentOrigin]
  )
  if (node.type === 'leaf') {
    // A pane holding a plugin has no PTY, no viewport and no activity state,
    // so none of the terminal wiring below applies to it. It gets the same
    // border and background, and mouse events reach the plugin's own elements.
    if (node.kind === 'plugin') {
      return <PluginPane paneId={node.tabId} isActive={node.tabId === activePluginPaneId} />
    }
    const tab = tabs.find((t) => t.id === node.tabId)
    const isActive = node.tabId === activeTabId
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
        junctionEdges={junctionEdgesMap.get(node.tabId)}
        mouseForwardingEnabled={isActive && mouseForwardingEnabled}
        localScrollbackEnabled={isActive && localScrollbackEnabled}
        onTerminalMouseEvent={onTerminalMouseEvent}
        onTerminalScrollEvent={onTerminalScrollEvent}
        onTerminalClick={onTerminalClick}
        onTerminalDrag={onTerminalDrag}
        onTerminalMouseUp={onTerminalMouseUp}
        onPaneActivate={onPaneActivate}
        onSeparatorDrag={onSeparatorDrag}
        onSeparatorDragEnd={onSeparatorDragEnd}
        onSeparatorDragStart={onSeparatorDragStart}
        onLeftEdgeMouseDown={onLeftEdgeMouseDown}
        onMeasure={onMeasure}
      />
    )
  }

  const flexDir = node.direction === 'vertical' ? 'row' : 'column'

  const rects = computePaneRects(node, bounds)
  const firstBounds = subtreeBounds(node.first, rects, bounds)
  const secondBounds = subtreeBounds(node.second, rects, bounds)

  const firstSize = node.direction === 'vertical' ? firstBounds.cols : firstBounds.rows
  const firstSizeProp = node.direction === 'vertical' ? { width: firstSize } : { height: firstSize }

  const secondLeftEdgeMouseDown = node.direction === 'horizontal' ? onLeftEdgeMouseDown : undefined

  return (
    <box flexDirection={flexDir} flexGrow={1} gap={0}>
      <box {...firstSizeProp} flexShrink={0} flexDirection="column" overflow="hidden">
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
          onTerminalDrag={onTerminalDrag}
          onTerminalMouseUp={onTerminalMouseUp}
          onPaneActivate={onPaneActivate}
          onSplitResize={onSplitResize}
          onSeparatorDragStart={onSeparatorDragStart}
          onSeparatorDrag={onSeparatorDrag}
          onSeparatorDragEnd={onSeparatorDragEnd}
          onLeftEdgeMouseDown={onLeftEdgeMouseDown}
          onMeasure={onMeasure}
          contentOrigin={contentOrigin}
          bounds={firstBounds}
          junctionEdgesMap={junctionEdgesMap}
        />
      </box>
      <box flexGrow={1} flexDirection="column" overflow="hidden">
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
          onTerminalDrag={onTerminalDrag}
          onTerminalMouseUp={onTerminalMouseUp}
          onPaneActivate={onPaneActivate}
          onSplitResize={onSplitResize}
          onSeparatorDragStart={onSeparatorDragStart}
          onSeparatorDrag={onSeparatorDrag}
          onSeparatorDragEnd={onSeparatorDragEnd}
          onLeftEdgeMouseDown={secondLeftEdgeMouseDown}
          onMeasure={onMeasure}
          contentOrigin={contentOrigin}
          bounds={secondBounds}
          junctionEdgesMap={junctionEdgesMap}
        />
      </box>
    </box>
  )
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
