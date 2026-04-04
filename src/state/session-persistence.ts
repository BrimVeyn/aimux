import type { AppState, TabSession, TabStatus, WorkspaceSnapshotV1 } from './types'

import {
  allLeafIds,
  createGroupId,
  createLeaf,
  type LayoutNode,
  pruneLayoutTree,
} from './layout-tree'

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

function getDisconnectedStatus(status: WorkspaceSnapshotV1['tabs'][number]['status']): TabStatus {
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
      status: tab.status === 'disconnected' ? 'running' : tab.status,
      terminalModes: tab.terminalModes,
      title: tab.title,
      viewport: tab.viewport,
    })),
    version: 1,
  }
}

export function restoreTabsFromWorkspace(snapshot: WorkspaceSnapshotV1 | undefined): TabSession[] {
  if (!snapshot || snapshot.version !== 1) {
    return []
  }

  return snapshot.tabs.map((tab) => ({
    activity: 'idle',
    assistant: tab.assistant,
    buffer: tab.buffer,
    command: tab.command,
    errorMessage: tab.errorMessage,
    exitCode: tab.exitCode,
    id: tab.id,
    status: getDisconnectedStatus(tab.status),
    terminalModes: tab.terminalModes,
    title: tab.title,
    viewport: tab.viewport,
  }))
}

export function restoreLayoutTree(
  snapshot: WorkspaceSnapshotV1 | undefined,
  tabs: TabSession[]
): LayoutNode | null {
  if (snapshot?.layoutTree) {
    const validTabIds = new Set(tabs.map((t) => t.id))
    const pruned = pruneLayoutTree(snapshot.layoutTree, validTabIds)
    if (pruned) return pruned
  }
  // Fallback: single leaf for the first tab
  return tabs[0] ? createLeaf(tabs[0].id) : null
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

function normalizeRestoredTabOrder(
  tabs: TabSession[],
  layoutTrees: Record<string, LayoutNode>,
  tabGroupMap: Record<string, string>
): TabSession[] {
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]))
  const emittedGroupIds = new Set<string>()
  const orderedTabs: TabSession[] = []

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
    for (const leafId of allLeafIds(groupTree)) {
      const groupTab = tabsById.get(leafId)
      if (groupTab) {
        orderedTabs.push(groupTab)
      }
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
  const orderedTabs = normalizeRestoredTabOrder(tabs, layoutTrees, tabGroupMap)

  return {
    activeTabId,
    focusMode: 'navigation',
    layoutTrees,
    sidebar: {
      ...state.sidebar,
      visible: workspaceSnapshot?.sidebar.visible ?? state.sidebar.visible,
      width: workspaceSnapshot?.sidebar.width ?? state.sidebar.width,
    },
    tabGroupMap,
    tabs: orderedTabs,
  }
}
