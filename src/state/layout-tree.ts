export type SplitDirection = 'horizontal' | 'vertical'

export type LayoutLeaf = { type: 'leaf'; tabId: string }
export type LayoutSplit = {
  type: 'split'
  direction: SplitDirection
  ratio: number
  first: LayoutNode
  second: LayoutNode
}
export type LayoutNode = LayoutLeaf | LayoutSplit

export interface PaneRect {
  x: number
  y: number
  cols: number
  rows: number
}

/** Border thickness on each side of a split pane (used to compute content size from outer bounds). */
export const PANE_BORDER = 1

const MIN_RATIO = 0.15
const MAX_RATIO = 0.85
const RATIO_STEP = 0.05

export function createLeaf(tabId: string): LayoutLeaf {
  return { type: 'leaf', tabId }
}

export function splitNode(
  tree: LayoutNode,
  targetTabId: string,
  direction: SplitDirection,
  newTabId: string
): LayoutNode {
  if (tree.type === 'leaf') {
    if (tree.tabId === targetTabId) {
      return {
        type: 'split',
        direction,
        ratio: 0.5,
        first: tree,
        second: createLeaf(newTabId),
      }
    }
    return tree
  }

  const newFirst = splitNode(tree.first, targetTabId, direction, newTabId)
  if (newFirst !== tree.first) {
    return { ...tree, first: newFirst }
  }

  const newSecond = splitNode(tree.second, targetTabId, direction, newTabId)
  if (newSecond !== tree.second) {
    return { ...tree, second: newSecond }
  }

  return tree
}

export function removeNode(tree: LayoutNode, tabId: string): LayoutNode | null {
  if (tree.type === 'leaf') {
    return tree.tabId === tabId ? null : tree
  }

  const newFirst = removeNode(tree.first, tabId)
  const newSecond = removeNode(tree.second, tabId)

  if (newFirst === null && newSecond === null) {
    return null
  }
  if (newFirst === null) {
    return newSecond
  }
  if (newSecond === null) {
    return newFirst
  }

  if (newFirst !== tree.first || newSecond !== tree.second) {
    return { ...tree, first: newFirst, second: newSecond }
  }

  return tree
}

export function findLeaf(tree: LayoutNode, tabId: string): boolean {
  if (tree.type === 'leaf') {
    return tree.tabId === tabId
  }
  return findLeaf(tree.first, tabId) || findLeaf(tree.second, tabId)
}

export function allLeafIds(tree: LayoutNode): string[] {
  if (tree.type === 'leaf') {
    return [tree.tabId]
  }
  return [...allLeafIds(tree.first), ...allLeafIds(tree.second)]
}

export function pruneLayoutTree(tree: LayoutNode, validTabIds: Set<string>): LayoutNode | null {
  if (tree.type === 'leaf') {
    return validTabIds.has(tree.tabId) ? tree : null
  }
  const first = pruneLayoutTree(tree.first, validTabIds)
  const second = pruneLayoutTree(tree.second, validTabIds)
  if (!first && !second) return null
  if (!first) return second
  if (!second) return first
  if (first === tree.first && second === tree.second) return tree
  return { ...tree, first, second }
}

export function resizeSplit(
  tree: LayoutNode,
  targetTabId: string,
  delta: number,
  axis?: SplitDirection
): LayoutNode {
  if (tree.type === 'leaf') {
    return tree
  }

  const inFirst = findLeaf(tree.first, targetTabId)
  const inSecond = findLeaf(tree.second, targetTabId)

  if (!inFirst && !inSecond) {
    return tree
  }

  // If axis is specified, only resize splits matching that axis
  const canResizeThis = !axis || tree.direction === axis

  if (inFirst || inSecond) {
    // First try to recurse deeper
    if (inFirst) {
      const newFirst = resizeSplit(tree.first, targetTabId, delta, axis)
      if (newFirst !== tree.first) return { ...tree, first: newFirst }
    } else {
      const newSecond = resizeSplit(tree.second, targetTabId, delta, axis)
      if (newSecond !== tree.second) return { ...tree, second: newSecond }
    }

    // Couldn't resize deeper — resize this split if axis matches
    if (canResizeThis) {
      const newRatio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, tree.ratio + delta * RATIO_STEP))
      if (newRatio === tree.ratio) return tree
      return { ...tree, ratio: newRatio }
    }
  }

  return tree
}

export function computePaneRects(tree: LayoutNode, bounds: PaneRect): Map<string, PaneRect> {
  const result = new Map<string, PaneRect>()

  if (tree.type === 'leaf') {
    result.set(tree.tabId, bounds)
    return result
  }

  if (tree.direction === 'vertical') {
    // Split left/right
    const firstCols = Math.max(1, Math.floor(bounds.cols * tree.ratio))
    const secondCols = Math.max(1, bounds.cols - firstCols - 1) // -1 for separator

    const firstBounds: PaneRect = { x: bounds.x, y: bounds.y, cols: firstCols, rows: bounds.rows }
    const secondBounds: PaneRect = {
      x: bounds.x + firstCols + 1,
      y: bounds.y,
      cols: secondCols,
      rows: bounds.rows,
    }

    for (const [id, rect] of computePaneRects(tree.first, firstBounds)) {
      result.set(id, rect)
    }
    for (const [id, rect] of computePaneRects(tree.second, secondBounds)) {
      result.set(id, rect)
    }
  } else {
    // Split top/bottom
    const firstRows = Math.max(1, Math.floor(bounds.rows * tree.ratio))
    const secondRows = Math.max(1, bounds.rows - firstRows - 1) // -1 for separator

    const firstBounds: PaneRect = { x: bounds.x, y: bounds.y, cols: bounds.cols, rows: firstRows }
    const secondBounds: PaneRect = {
      x: bounds.x,
      y: bounds.y + firstRows + 1,
      cols: bounds.cols,
      rows: secondRows,
    }

    for (const [id, rect] of computePaneRects(tree.first, firstBounds)) {
      result.set(id, rect)
    }
    for (const [id, rect] of computePaneRects(tree.second, secondBounds)) {
      result.set(id, rect)
    }
  }

  return result
}

type NavDirection = 'left' | 'right' | 'up' | 'down'

function firstLeafId(node: LayoutNode): string {
  if (node.type === 'leaf') return node.tabId
  return firstLeafId(node.first)
}

function lastLeafId(node: LayoutNode): string {
  if (node.type === 'leaf') return node.tabId
  return lastLeafId(node.second)
}

export function getAdjacentLeaf(
  tree: LayoutNode,
  fromTabId: string,
  direction: NavDirection
): string | null {
  if (tree.type === 'leaf') {
    return null
  }

  const inFirst = findLeaf(tree.first, fromTabId)
  const inSecond = findLeaf(tree.second, fromTabId)

  if (!inFirst && !inSecond) {
    return null
  }

  // Check if the split direction matches the navigation direction
  const isMatchingDirection =
    (tree.direction === 'vertical' && (direction === 'left' || direction === 'right')) ||
    (tree.direction === 'horizontal' && (direction === 'up' || direction === 'down'))

  if (isMatchingDirection) {
    const goingToSecond = direction === 'right' || direction === 'down'

    if (inFirst && goingToSecond) {
      // Try to recurse in first child first
      const deeper = getAdjacentLeaf(tree.first, fromTabId, direction)
      if (deeper) return deeper
      // Cross boundary: go to first leaf of second child
      return firstLeafId(tree.second)
    }

    if (inSecond && !goingToSecond) {
      const deeper = getAdjacentLeaf(tree.second, fromTabId, direction)
      if (deeper) return deeper
      return lastLeafId(tree.first)
    }
  }

  // Direction doesn't match this split — recurse into the branch containing the tab
  if (inFirst) {
    return getAdjacentLeaf(tree.first, fromTabId, direction)
  }
  return getAdjacentLeaf(tree.second, fromTabId, direction)
}
