import type { ProjectSnapshotV1 } from './types'

import {
  allTabIds,
  computePaneRects,
  type LayoutNode,
  PANE_BORDER,
  type PaneRect,
} from './layout-tree'

export interface TerminalBounds {
  x: number
  y: number
  cols: number
  rows: number
}

export function getSnapshotTrees(snapshot: ProjectSnapshotV1 | undefined): LayoutNode[] {
  if (snapshot?.layoutTrees) {
    return Object.values(snapshot.layoutTrees)
  }

  if (snapshot?.layoutTree) {
    return [snapshot.layoutTree]
  }

  return []
}

export function createTerminalBounds(cols: number, rows: number): TerminalBounds {
  const chrome = PANE_BORDER * 2
  return {
    cols: cols + chrome,
    rows: rows + chrome,
    x: 0,
    y: 0,
  }
}

export function toTerminalContentSize(rect: PaneRect): { cols: number; rows: number } {
  const chrome = PANE_BORDER * 2
  return {
    cols: Math.max(1, rect.cols - chrome),
    rows: Math.max(1, rect.rows - chrome),
  }
}

/**
 * The rect of every *terminal* pane in every split.
 *
 * The rects come from the whole tree — a plugin pane takes up space, and
 * leaving it out would put every terminal beside it at the wrong size — but
 * only tabs are handed back, because the caller's next move is to resize a PTY
 * and a plugin pane does not have one.
 */
export function forEachSplitPaneRect(
  trees: LayoutNode[],
  bounds: TerminalBounds,
  callback: (tabId: string, rect: PaneRect) => void
): void {
  for (const tree of trees) {
    if (tree.type !== 'split') {
      continue
    }

    const tabs = new Set(allTabIds(tree))
    for (const [paneId, rect] of computePaneRects(tree, bounds)) {
      if (!tabs.has(paneId)) continue
      callback(paneId, rect)
    }
  }
}
