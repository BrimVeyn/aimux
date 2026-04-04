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
    version: 1,
    savedAt: new Date().toISOString(),
    activeTabId: null,
    sidebar: {
      visible: true,
      width: 28,
    },
    tabs: [],
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
    version: 1,
    savedAt: new Date().toISOString(),
    activeTabId: state.activeTabId,
    sidebar: {
      visible: state.sidebar.visible,
      width: state.sidebar.width,
    },
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      assistant: tab.assistant,
      title: tab.title,
      command: tab.command,
      status: tab.status === 'disconnected' ? 'running' : tab.status,
      buffer: tab.buffer,
      viewport: tab.viewport,
      terminalModes: tab.terminalModes,
      errorMessage: tab.errorMessage,
      exitCode: tab.exitCode,
    })),
    layoutTree: Object.values(state.layoutTrees)[0] ?? undefined,
    layoutTrees: Object.keys(state.layoutTrees).length > 0 ? state.layoutTrees : undefined,
    tabGroupMap: Object.keys(state.tabGroupMap).length > 0 ? state.tabGroupMap : undefined,
  }
}

export function restoreTabsFromWorkspace(snapshot: WorkspaceSnapshotV1 | undefined): TabSession[] {
  if (!snapshot || snapshot.version !== 1) {
    return []
  }

  return snapshot.tabs.map((tab) => ({
    id: tab.id,
    assistant: tab.assistant,
    title: tab.title,
    status: getDisconnectedStatus(tab.status),
    activity: 'idle',
    buffer: tab.buffer,
    viewport: tab.viewport,
    terminalModes: tab.terminalModes,
    command: tab.command,
    errorMessage: tab.errorMessage,
    exitCode: tab.exitCode,
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

  return {
    tabs,
    activeTabId,
    layoutTrees,
    tabGroupMap,
    focusMode: 'navigation',
    sidebar: {
      ...state.sidebar,
      visible: workspaceSnapshot?.sidebar.visible ?? state.sidebar.visible,
      width: workspaceSnapshot?.sidebar.width ?? state.sidebar.width,
    },
  }
}
