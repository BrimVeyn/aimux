import type { TabSession } from './types'

import { allLeafIds, type LayoutNode } from './layout-tree'

export interface SingleEntry {
  kind: 'single'
  id: string
  tab: TabSession
}

export interface GroupEntry {
  kind: 'group'
  id: string
  groupId: string
  tabs: TabSession[]
  activeLeafId: string
}

export type TabEntry = SingleEntry | GroupEntry

/**
 * Collapse a list of visible tabs into "tab strip entries": one entry per
 * standalone tab, one entry per multi-leaf layout group (split). Tabs that
 * belong to a layout tree with only one leaf are treated as standalone.
 *
 * Within a group entry, `activeLeafId` is `activeTabId` when it falls inside
 * the group, otherwise the first leaf in the underlying tabs order.
 */
export function buildTabEntries(
  visibleTabs: TabSession[],
  layoutTrees: Record<string, LayoutNode>,
  tabGroupMap: Record<string, string>,
  activeTabId: string | null
): TabEntry[] {
  // Set of groupIds that are real splits (>= 2 leaves).
  const splitGroupIds = new Set<string>()
  for (const [groupId, tree] of Object.entries(layoutTrees)) {
    if (allLeafIds(tree).length >= 2) {
      splitGroupIds.add(groupId)
    }
  }

  const entries: TabEntry[] = []
  const emittedGroupIds = new Set<string>()

  for (const tab of visibleTabs) {
    const groupId = tabGroupMap[tab.id]
    const inSplit = groupId != null && groupId !== '' && splitGroupIds.has(groupId)

    if (!inSplit) {
      entries.push({ id: tab.id, kind: 'single', tab })
      continue
    }

    if (emittedGroupIds.has(groupId)) continue
    emittedGroupIds.add(groupId)

    const members = visibleTabs.filter((t) => tabGroupMap[t.id] === groupId)
    const activeLeafId =
      activeTabId != null && members.some((t) => t.id === activeTabId)
        ? activeTabId
        : (members[0]?.id ?? tab.id)

    entries.push({
      activeLeafId,
      groupId,
      id: groupId,
      kind: 'group',
      tabs: members,
    })
  }

  return entries
}
