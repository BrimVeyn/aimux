import { allLeafIds, getTreeForTab, type LayoutNode } from '../state/layout-tree'

/**
 * The set of tab ids whose terminal renders must be streamed to the browser:
 * every leaf of the active tab's layout-tree group, else just the active tab.
 */
export function computeVisibleTabIds(
  layoutTrees: Record<string, LayoutNode>,
  tabGroupMap: Record<string, string>,
  activeTabId: string | null
): string[] {
  if (activeTabId === null) {
    return []
  }
  const tree = getTreeForTab(layoutTrees, tabGroupMap, activeTabId)
  if (tree === null) {
    return [activeTabId]
  }
  return allLeafIds(tree)
}
