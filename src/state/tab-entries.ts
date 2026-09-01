import type { TabSession } from './types'

import { allLeafIds, type LayoutNode } from './layout-tree'

// Generic over the tab shape: the strip only ever reads `id`, so the GUI
// renderer can build the same entries from its wire-level `ProjectedTab`
// instead of keeping a second copy of the grouping rules.
export interface SingleEntry<T extends { id: string } = TabSession> {
  kind: 'single'
  id: string
  tab: T
}

export interface GroupEntry<T extends { id: string } = TabSession> {
  kind: 'group'
  id: string
  groupId: string
  tabs: T[]
  activeLeafId: string
}

export type TabEntry<T extends { id: string } = TabSession> = SingleEntry<T> | GroupEntry<T>

/**
 * Collapse a list of visible tabs into "tab strip entries": one entry per
 * standalone tab, one entry per multi-leaf layout group (split). Tabs that
 * belong to a layout tree with only one leaf are treated as standalone.
 *
 * Within a group entry, `activeLeafId` is `activeTabId` when it falls inside
 * the group, otherwise the first leaf in the underlying tabs order.
 */
export function buildTabEntries<T extends { id: string }>(
  visibleTabs: T[],
  layoutTrees: Record<string, LayoutNode>,
  tabGroupMap: Record<string, string>,
  activeTabId: string | null
): TabEntry<T>[] {
  // Set of groupIds that are real splits (>= 2 leaves).
  const splitGroupIds = new Set<string>()
  for (const [groupId, tree] of Object.entries(layoutTrees)) {
    if (allLeafIds(tree).length >= 2) {
      splitGroupIds.add(groupId)
    }
  }

  const entries: TabEntry<T>[] = []
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

// Generic over the tab and project shapes for the same reason as
// `buildTabEntries`: the GUI renderer filters its wire-level projections with
// this exact rule, and a second copy would drift.
export function filterTabsForActiveWorkspace<
  T extends { id: string; hidden?: boolean; workspaceId?: string },
>(
  tabs: T[],
  project: { activeWorkspaceId?: string; workspaces?: { id: string }[] } | undefined
): T[] {
  const visible = tabs.filter((tab) => tab.hidden !== true)
  if (!project) return visible
  const activeWorkspaceId = project.activeWorkspaceId
  if (activeWorkspaceId == null || activeWorkspaceId === '') return visible
  const workspaces = project.workspaces ?? []
  const primaryId = workspaces[0]?.id
  const activeIsPrimary = primaryId != null && primaryId === activeWorkspaceId
  return visible.filter((tab) => {
    const owned = tab.workspaceId != null && tab.workspaceId !== ''
    if (owned) return tab.workspaceId === activeWorkspaceId
    // Unbound (legacy) tabs surface only under the primary workspace.
    return activeIsPrimary
  })
}
