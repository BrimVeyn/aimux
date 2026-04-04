import type { WorkspaceSnapshotV1 } from './types'

import { computePaneRects, type LayoutNode, PANE_BORDER, type PaneRect } from './layout-tree'

export interface TerminalBounds {
  x: number
  y: number
  cols: number
  rows: number
}

export function getSnapshotTrees(snapshot: WorkspaceSnapshotV1 | undefined): LayoutNode[] {
  if (snapshot?.layoutTrees) {
    return Object.values(snapshot.layoutTrees)
  }

  if (snapshot?.layoutTree) {
    return [snapshot.layoutTree]
  }

  return []
}

export function createTerminalBounds(cols: number, rows: number): TerminalBounds {
  return { cols, rows, x: 0, y: 0 }
}

export function toTerminalContentSize(rect: PaneRect): { cols: number; rows: number } {
  const chrome = PANE_BORDER * 2
  return {
    cols: Math.max(1, rect.cols - chrome),
    rows: Math.max(1, rect.rows - chrome),
  }
}

export function forEachSplitPaneRect(
  trees: LayoutNode[],
  bounds: TerminalBounds,
  callback: (tabId: string, rect: PaneRect) => void
): void {
  for (const tree of trees) {
    if (tree.type !== 'split') {
      continue
    }

    for (const [tabId, rect] of computePaneRects(tree, bounds)) {
      callback(tabId, rect)
    }
  }
}
