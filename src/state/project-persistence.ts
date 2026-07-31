import type { AppState, TabSession, TabStatus, WorkspaceSnapshotV1 } from './types'

import { allLeafIds, createGroupId, type LayoutNode, pruneLayoutTree } from './layout-tree'

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

/**
 * The per-worktree last-tab memory is serialized into every snapshot now so the
 * data accrues across projects, but restoring it at startup stays dormant until
 * a future (non-breaking) change is ready to consume it. Flipping this to true
 * makes restart restore the last-viewed tab per worktree; until then restart
 * behavior is unchanged and the live in-memory map is never clobbered on switch.
 */
const RESTORE_LAST_ACTIVE_TAB_BY_WORKTREE: boolean = false

function getDisconnectedStatus(status: TabStatus): TabStatus {
  if (status === 'running' || status === 'starting') {
    return 'disconnected'
  }

  return status
}

export function serializeWorkspace(state: AppState): WorkspaceSnapshotV1 {
  return {
    activeTabId: state.activeTabId,
    lastActiveTabByWorktree:
      Object.keys(state.lastActiveTabByWorktree).length > 0
        ? state.lastActiveTabByWorktree
        : undefined,
    layoutTree: Object.values(state.layoutTrees)[0] ?? undefined,
    layoutTrees: Object.keys(state.layoutTrees).length > 0 ? state.layoutTrees : undefined,
    savedAt: new Date().toISOString(),
    // Mirror of the left bar. `isWorkspaceSnapshotV1` requires this key —
    // dropping it invalidates every entry in the project catalog.
    sidebar: {
      visible: state.bars.left.visible,
      width: state.bars.left.width,
    },
    tabGroupMap: Object.keys(state.tabGroupMap).length > 0 ? state.tabGroupMap : undefined,
    tabs: state.tabs.map((tab) => ({
      assistant: tab.assistant,
      autoRenameStatus: tab.autoRenameStatus,
      buffer: tab.buffer,
      command: tab.command,
      errorMessage: tab.errorMessage,
      exitCode: tab.exitCode,
      id: tab.id,
      status: tab.status === 'disconnected' ? 'running' : tab.status,
      terminalModes: tab.terminalModes,
      title: tab.title,
      viewport: tab.viewport,
      workerName: tab.workerName,
      worktreeId: tab.worktreeId,
    })),
    version: 1,
  }
}

export interface RestoreOptions {
  // Force any running/starting tab to 'disconnected' on restore. True for
  // cold-start (daemon may not own the projects yet) and the daemon's own
  // catalog hydration. False for live in-app workspace switches where an
  // attach() is guaranteed to follow within a frame and hydrate-workspace
  // will overwrite the status with daemon truth — leaving the flag on would
  // briefly flash the "Restored snapshot" hint on every j/k cycle.
  forceDisconnected?: boolean
  // When provided, drop tabs pinned to a worktree id that the project no
  // longer owns. Some delete paths (notably the sidebar's "Remove worktree")
  // historically removed the worktree record without closing its tabs, leaving
  // orphans bound to a vanished id. Those orphans are invisible (filtered out
  // by the active-worktree filter) yet keep a worktree id that a *future*
  // delete can collide with — exactly what closes "another worktree's" tabs.
  // Pruning them on restore both repairs corrupted catalogs and prevents the
  // collision. Tabs with no worktree id (legacy/unbound) are always kept.
  validWorktreeIds?: ReadonlySet<string>
}

// Drop tabs bound to a worktree id the project no longer owns. Unbound tabs
// (no worktreeId) are kept — they surface under the primary worktree.
function pruneOrphanedTabs(
  tabs: TabSession[],
  validWorktreeIds: ReadonlySet<string> | undefined
): TabSession[] {
  if (!validWorktreeIds) return tabs
  return tabs.filter(
    (tab) => tab.worktreeId == null || tab.worktreeId === '' || validWorktreeIds.has(tab.worktreeId)
  )
}

export function restoreTabsFromWorkspace(
  snapshot: WorkspaceSnapshotV1 | undefined,
  options: RestoreOptions = {}
): TabSession[] {
  if (!snapshot || snapshot.version !== 1) {
    return []
  }

  const forceDisconnected = options.forceDisconnected ?? true

  const restored: TabSession[] = snapshot.tabs
    .filter(
      (tab): tab is typeof tab & { status: Exclude<typeof tab.status, 'exited'> } =>
        tab.status !== 'exited'
    )
    .map((tab) => ({
      activity: 'idle',
      assistant: tab.assistant,
      autoRenameStatus: tab.autoRenameStatus,
      buffer: tab.buffer,
      command: tab.command,
      errorMessage: tab.errorMessage,
      exitCode: tab.exitCode,
      id: tab.id,
      status: forceDisconnected ? getDisconnectedStatus(tab.status) : tab.status,
      terminalModes: tab.terminalModes,
      title: tab.title,
      viewport: tab.viewport,
      workerName: tab.workerName,
      worktreeId: tab.worktreeId,
    }))
  return pruneOrphanedTabs(restored, options.validWorktreeIds)
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

// When a worktree is removed, its tabs are killed live via disposeWorktreeTabs
// — but the project's persisted workspaceSnapshot still references them by
// worktreeId. Without this pruning, a subsequent load-project (project switch
// or restart) resurrects the dead tabs and they reappear in h-l navigation.
export function pruneSnapshotOfWorktree(
  snapshot: WorkspaceSnapshotV1 | undefined,
  worktreeId: string
): WorkspaceSnapshotV1 | undefined {
  if (!snapshot) return snapshot
  const keptTabs = snapshot.tabs.filter((tab) => tab.worktreeId !== worktreeId)
  if (keptTabs.length === snapshot.tabs.length) return snapshot
  const validTabIds = new Set(keptTabs.map((tab) => tab.id))

  let nextLayoutTrees: typeof snapshot.layoutTrees
  let nextTabGroupMap: typeof snapshot.tabGroupMap
  if (snapshot.layoutTrees) {
    const trees: Record<string, LayoutNode> = {}
    const groupMap: Record<string, string> = {}
    for (const [groupId, tree] of Object.entries(snapshot.layoutTrees)) {
      const pruned = pruneLayoutTree(tree, validTabIds)
      if (pruned && pruned.type === 'split') {
        trees[groupId] = pruned
        for (const leafId of allLeafIds(pruned)) {
          groupMap[leafId] = groupId
        }
      }
    }
    nextLayoutTrees = Object.keys(trees).length > 0 ? trees : undefined
    nextTabGroupMap = Object.keys(groupMap).length > 0 ? groupMap : undefined
  }

  let nextLayoutTree = snapshot.layoutTree
  if (nextLayoutTree) {
    const pruned = pruneLayoutTree(nextLayoutTree, validTabIds)
    nextLayoutTree = pruned && pruned.type === 'split' ? pruned : undefined
  }

  const nextActiveTabId =
    snapshot.activeTabId != null && validTabIds.has(snapshot.activeTabId)
      ? snapshot.activeTabId
      : (keptTabs[0]?.id ?? null)

  return {
    ...snapshot,
    activeTabId: nextActiveTabId,
    layoutTree: nextLayoutTree,
    layoutTrees: nextLayoutTrees,
    tabGroupMap: nextTabGroupMap,
    tabs: keptTabs,
  }
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
    if (!(groupId != null && groupId !== '')) {
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
    const groupTree = groupId != null && groupId !== '' ? layoutTrees[groupId] : undefined

    if (groupId == null || groupId === '' || !groupTree || groupTree.type !== 'split') {
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
  workspaceSnapshot: WorkspaceSnapshotV1 | undefined,
  options: RestoreOptions = {}
): Pick<AppState, 'tabs' | 'activeTabId' | 'focusMode' | 'layoutTrees' | 'tabGroupMap'> &
  Partial<Pick<AppState, 'lastActiveTabByWorktree'>> {
  const tabs = restoreTabsFromWorkspace(workspaceSnapshot, options)
  const activeTabId =
    workspaceSnapshot?.activeTabId != null &&
    workspaceSnapshot?.activeTabId !== '' &&
    tabs.some((tab) => tab.id === workspaceSnapshot.activeTabId)
      ? workspaceSnapshot.activeTabId
      : (tabs[0]?.id ?? null)

  const { layoutTrees, tabGroupMap } = restoreLayoutTrees(workspaceSnapshot, tabs)
  const orderedTabs = normalizeGroupedTabOrder(tabs, layoutTrees, tabGroupMap)

  // Dormant until the gate flips: merge the persisted per-worktree memory over
  // the live in-memory map. While off, the key is omitted entirely so callers
  // that spread the result never overwrite their existing map on a switch.
  const persistedLastActiveTab =
    RESTORE_LAST_ACTIVE_TAB_BY_WORKTREE && workspaceSnapshot?.lastActiveTabByWorktree
      ? { ...state.lastActiveTabByWorktree, ...workspaceSnapshot.lastActiveTabByWorktree }
      : undefined

  return {
    activeTabId,
    focusMode: 'navigation',
    layoutTrees,
    tabGroupMap,
    tabs: orderedTabs,
    ...(persistedLastActiveTab ? { lastActiveTabByWorktree: persistedLastActiveTab } : {}),
  }
}
