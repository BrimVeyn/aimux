import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import type { TerminalContentOrigin } from '../../input/raw-input-handler'
import type { LayoutNode, PaneRect } from '../../state/layout-tree'
import type { FocusMode, TabSession } from '../../state/types'

import { computePaneRects } from '../../state/layout-tree'
import { theme } from '../theme'
import { TerminalPane } from './terminal-pane'

// Border(1) on each side of TerminalPane's content box (no padding)
const PANE_CHROME = 1

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
  contentOrigin: TerminalContentOrigin
  bounds: PaneRect
}

export function SplitLayout({
  node,
  tabs,
  activeTabId,
  focusMode,
  mouseForwardingEnabled,
  localScrollbackEnabled,
  onTerminalMouseEvent,
  onTerminalScrollEvent,
  onTerminalClick,
  onPaneActivate,
  contentOrigin,
  bounds,
}: SplitLayoutProps) {
  if (node.type === 'leaf') {
    const tab = tabs.find((t) => t.id === node.tabId)
    const isActive = node.tabId === activeTabId
    const paneOrigin: TerminalContentOrigin = {
      x: contentOrigin.x + bounds.x + PANE_CHROME,
      y: contentOrigin.y + bounds.y + PANE_CHROME,
      cols: Math.max(1, bounds.cols - PANE_CHROME * 2),
      rows: Math.max(1, bounds.rows - PANE_CHROME * 2),
    }
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
      />
    )
  }

  const flexDir = node.direction === 'vertical' ? 'row' : 'column'
  const firstGrow = Math.round(node.ratio * 100)
  const secondGrow = 100 - firstGrow

  // Compute sub-bounds for each child
  const rects = computePaneRects(node, bounds)
  const firstLeafId = getFirstLeafId(node.first)
  const secondLeafId = getFirstLeafId(node.second)
  const firstRect = (firstLeafId && rects.get(firstLeafId)) ?? bounds
  const secondRect = (secondLeafId && rects.get(secondLeafId)) ?? bounds

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
          contentOrigin={contentOrigin}
          bounds={firstBounds}
        />
      </box>
      <box
        minWidth={node.direction === 'vertical' ? 1 : undefined}
        minHeight={node.direction === 'horizontal' ? 1 : undefined}
        backgroundColor={theme.border}
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
    x,
    y,
    cols: Math.max(firstBounds.x + firstBounds.cols, lastBounds.x + lastBounds.cols) - x,
    rows: Math.max(firstBounds.y + firstBounds.rows, lastBounds.y + lastBounds.rows) - y,
  }
}
