import { allLeafIds, createGroupId, type LayoutNode, pruneLayoutTree } from './layout-tree'
import {
  type AppState,
  DEFAULT_SCROLL_INTENT,
  type ScrollIntent,
  type TabSession,
  type TabStatus,
  type WorkspaceSnapshotV1,
} from './types'

export function createEmptyWorkspaceSnapshot(): WorkspaceSnapshotV1 {
  return {
    activeTabId: null,
    savedAt: new Date().toISOString(),
    sidebar: {
      visible: true,
      width: 28,
    },
    tabs: [],
    version: 1,
  }
}

function getDisconnectedStatus(status: TabStatus): TabStatus {
  if (status === 'running' || status === 'starting') {
    return 'disconnected'
  }

  return status
}

export function serializeWorkspace(state: AppState): WorkspaceSnapshotV1 {
  return {
    activeTabId: state.activeTabId,
    layoutTree: Object.values(state.layoutTrees)[0] ?? undefined,
    layoutTrees: Object.keys(state.layoutTrees).length > 0 ? state.layoutTrees : undefined,
    savedAt: new Date().toISOString(),
    sidebar: {
      visible: state.sidebar.visible,
      width: state.sidebar.width,
    },
    tabGroupMap: Object.keys(state.tabGroupMap).length > 0 ? state.tabGroupMap : undefined,
    tabs: state.tabs.map((tab) => ({
      assistant: tab.assistant,
      buffer: tab.buffer,
      command: tab.command,
      errorMessage: tab.errorMessage,
      exitCode: tab.exitCode,
      id: tab.id,
      scrollIntent: tab.scrollIntent,
      status: tab.status === 'disconnected' ? 'running' : tab.status,
      terminalModes: tab.terminalModes,
      title: tab.title,
      viewport: tab.viewport,
      worktreeId: tab.worktreeId,
    })),
    version: 1,
  }
}

export function restoreTabsFromWorkspace(snapshot: WorkspaceSnapshotV1 | undefined): TabSession[] {
  if (!snapshot || snapshot.version !== 1) {
    return []
  }

  return snapshot.tabs
    .filter(
      (tab): tab is typeof tab & { status: Exclude<typeof tab.status, 'exited'> } =>
        tab.status !== 'exited'
    )
    .map((tab) => ({
      activity: 'idle',
      assistant: tab.assistant,
      buffer: tab.buffer,
      command: tab.command,
      errorMessage: tab.errorMessage,
      exitCode: tab.exitCode,
      id: tab.id,
      scrollIntent: tab.scrollIntent ?? DEFAULT_SCROLL_INTENT,
      status: getDisconnectedStatus(tab.status),
      terminalModes: tab.terminalModes,
      title: tab.title,
      viewport: tab.viewport,
      worktreeId: tab.worktreeId,
    }))
}

export function getSnapshotScrollIntents(
  snapshot: WorkspaceSnapshotV1 | undefined
): Map<string, ScrollIntent> {
  if (!snapshot || snapshot.version !== 1) {
    return new Map()
  }

  return new Map(
    snapshot.tabs.map((tab) => [tab.id, tab.scrollIntent ?? DEFAULT_SCROLL_INTENT] as const)
  )
}

export function restoreLayoutTrees(
  snapshot: WorkspaceSnapshotV1 | undefined,
  tabs: TabSession[]
): { layoutTrees: Record<string, LayoutNode>; tabGroupMap: Record<string, string> } {
  const validTabIds = new Set(tabs.map((t) => t.id))
  const layoutTrees: Record<string, LayoutNode> = {}
  const tabGroupMap: Record<string, string> = {}

  if (snapshot?.layoutTrees && snapshot?.tabGroupMap) {
    // New format
    for (const [gId, tree] of Object.entries(snapshot.layoutTrees)) {
      const pruned = pruneLayoutTree(tree, validTabIds)
      if (pruned && pruned.type === 'split') {
        layoutTrees[gId] = pruned
        for (const leafId of allLeafIds(pruned)) {
          tabGroupMap[leafId] = gId
        }
      }
    }
  } else if (snapshot?.layoutTree) {
    // Legacy migration
    const pruned = pruneLayoutTree(snapshot.layoutTree, validTabIds)
    if (pruned && pruned.type === 'split') {
      const gId = createGroupId()
      layoutTrees[gId] = pruned
      for (const leafId of allLeafIds(pruned)) {
        tabGroupMap[leafId] = gId
      }
    }
  }

  return { layoutTrees, tabGroupMap }
}

export function normalizeGroupedTabOrder(
  tabs: TabSession[],
  layoutTrees: Record<string, LayoutNode>,
  tabGroupMap: Record<string, string>
): TabSession[] {
  const groupedTabsByGroupId = new Map<string, TabSession[]>()
  const emittedGroupIds = new Set<string>()
  const orderedTabs: TabSession[] = []

  for (const tab of tabs) {
    const groupId = tabGroupMap[tab.id]
    if (!groupId) {
      continue
    }

    const groupTree = layoutTrees[groupId]
    if (!groupTree || groupTree.type !== 'split') {
      continue
    }

    const groupedTabs = groupedTabsByGroupId.get(groupId)
    if (groupedTabs) {
      groupedTabs.push(tab)
      continue
    }

    groupedTabsByGroupId.set(groupId, [tab])
  }

  for (const tab of tabs) {
    const groupId = tabGroupMap[tab.id]
    const groupTree = groupId ? layoutTrees[groupId] : undefined

    if (!groupId || !groupTree || groupTree.type !== 'split') {
      orderedTabs.push(tab)
      continue
    }

    if (emittedGroupIds.has(groupId)) {
      continue
    }

    emittedGroupIds.add(groupId)
    const groupedTabs = groupedTabsByGroupId.get(groupId)
    if (!groupedTabs) {
      continue
    }

    for (const groupTab of groupedTabs) {
      orderedTabs.push(groupTab)
    }
  }

  return orderedTabs
}

export function restoreWorkspaceState(
  state: AppState,
  workspaceSnapshot: WorkspaceSnapshotV1 | undefined
): Pick<
  AppState,
  'tabs' | 'activeTabId' | 'focusMode' | 'sidebar' | 'layoutTrees' | 'tabGroupMap'
> {
  const tabs = restoreTabsFromWorkspace(workspaceSnapshot)
  const activeTabId =
    workspaceSnapshot?.activeTabId && tabs.some((tab) => tab.id === workspaceSnapshot.activeTabId)
      ? workspaceSnapshot.activeTabId
      : (tabs[0]?.id ?? null)

  const { layoutTrees, tabGroupMap } = restoreLayoutTrees(workspaceSnapshot, tabs)
  const orderedTabs = normalizeGroupedTabOrder(tabs, layoutTrees, tabGroupMap)

  return {
    activeTabId,
    focusMode: 'navigation',
    layoutTrees,
    sidebar: state.sidebar,
    tabGroupMap,
    tabs: orderedTabs,
  }
}
