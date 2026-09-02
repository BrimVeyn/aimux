import type { AppState, ProjectSnapshotV1, TabSession, TabStatus } from './types'

import {
  allTabIds,
  createGroupId,
  type LayoutNode,
  pruneLayoutTree,
  stripPluginPanes,
} from './layout-tree'

export function createEmptyProjectSnapshot(): ProjectSnapshotV1 {
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
 * The per-workspace last-tab memory is serialized into every snapshot now so the
 * data accrues across projects, but restoring it at startup stays dormant until
 * a future (non-breaking) change is ready to consume it. Flipping this to true
 * makes restart restore the last-viewed tab per workspace; until then restart
 * behavior is unchanged and the live in-memory map is never clobbered on switch.
 */
const RESTORE_LAST_ACTIVE_TAB_BY_WORKSPACE: boolean = false

function getDisconnectedStatus(status: TabStatus): TabStatus {
  if (status === 'running' || status === 'starting') {
    return 'disconnected'
  }

  return status
}

/**
 * The layout as it goes to disk: terminals only, and the group map rebuilt
 * from what survived. A group that was only holding a terminal and a plugin
 * pane is not a split any more, so it is not written as one.
 */
function persistableLayout(state: AppState): {
  trees: Record<string, LayoutNode>
  groupMap: Record<string, string>
} {
  const trees: Record<string, LayoutNode> = {}
  const groupMap: Record<string, string> = {}
  for (const [groupId, tree] of Object.entries(state.layoutTrees)) {
    const stripped = stripPluginPanes(tree)
    if (!stripped || stripped.type !== 'split') continue
    trees[groupId] = stripped
    for (const leafId of allTabIds(stripped)) groupMap[leafId] = groupId
  }
  return { groupMap, trees }
}

export function serializeProject(state: AppState): ProjectSnapshotV1 {
  const { groupMap: persistedGroupMap, trees: persistedTrees } = persistableLayout(state)
  return {
    activeTabId: state.activeTabId,
    lastActiveTabByWorkspace:
      Object.keys(state.lastActiveTabByWorkspace).length > 0
        ? state.lastActiveTabByWorkspace
        : undefined,
    layoutTree: Object.values(persistedTrees)[0] ?? undefined,
    layoutTrees: Object.keys(persistedTrees).length > 0 ? persistedTrees : undefined,
    savedAt: new Date().toISOString(),
    // Mirror of the left bar. `isProjectSnapshotV1` requires this key —
    // dropping it invalidates every entry in the project catalog.
    sidebar: {
      visible: state.bars.left.visible,
      width: state.bars.left.width,
    },
    tabGroupMap: Object.keys(persistedGroupMap).length > 0 ? persistedGroupMap : undefined,
    // Hidden tabs (the setup runner's PTY) are session-scoped on purpose: the
    // durable record of a setup run is `WorkspaceRecord.setupRanAt`, and keeping
    // them out here is what lets `hidden` stay off the ipc/daemon wire.
    tabs: state.tabs
      .filter((tab) => tab.hidden !== true)
      .map((tab) => ({
        assistant: tab.assistant,
        autoRenameStatus: tab.autoRenameStatus,
        buffer: tab.buffer,
        command: tab.command,
        errorMessage: tab.errorMessage,
        exitCode: tab.exitCode,
        id: tab.id,
        sessionId: tab.sessionId,
        status: tab.status === 'disconnected' ? 'running' : tab.status,
        terminalModes: tab.terminalModes,
        title: tab.title,
        viewport: tab.viewport,
        workerName: tab.workerName,
        workspaceId: tab.workspaceId,
      })),
    version: 1,
  }
}

export interface RestoreOptions {
  // Force any running/starting tab to 'disconnected' on restore. True for
  // cold-start (daemon may not own the projects yet) and the daemon's own
  // catalog hydration. False for live in-app project switches where an
  // attach() is guaranteed to follow within a frame and hydrate-project
  // will overwrite the status with daemon truth — leaving the flag on would
  // briefly flash the "Restored snapshot" hint on every j/k cycle.
  forceDisconnected?: boolean
  // When provided, drop tabs pinned to a workspace id that the project no
  // longer owns. Some delete paths (notably the sidebar's "Remove workspace")
  // historically removed the workspace record without closing its tabs, leaving
  // orphans bound to a vanished id. Those orphans are invisible (filtered out
  // by the active-workspace filter) yet keep a workspace id that a *future*
  // delete can collide with — exactly what closes "another workspace's" tabs.
  // Pruning them on restore both repairs corrupted catalogs and prevents the
  // collision. Tabs with no workspace id (legacy/unbound) are always kept.
  validWorkspaceIds?: ReadonlySet<string>
}

// Drop tabs bound to a workspace id the project no longer owns. Unbound tabs
// (no workspaceId) are kept — they surface under the primary workspace.
function pruneOrphanedTabs(
  tabs: TabSession[],
  validWorkspaceIds: ReadonlySet<string> | undefined
): TabSession[] {
  if (!validWorkspaceIds) return tabs
  return tabs.filter(
    (tab) =>
      tab.workspaceId == null || tab.workspaceId === '' || validWorkspaceIds.has(tab.workspaceId)
  )
}

/**
 * Recover a session id a snapshot lost. Until the client stopped adopting the
 * daemon's tabs wholesale, `sessionId` was wiped on every attach while the
 * daemon's argv echo left the uuid sitting in `command` — so the conversation
 * these tabs own is still recoverable from the very string that broke them.
 *
 * ponytail: a migration, not a mechanism. Delete it once no snapshot in the
 * wild predates the fix.
 */
function recoverSessionId(command: string): string | undefined {
  return /(?:^|\s)(?:-r|--resume|--session-id)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\s|$)/i.exec(
    command
  )?.[1]
}

export function restoreTabsFromProject(
  snapshot: ProjectSnapshotV1 | undefined,
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
      sessionId: tab.sessionId ?? recoverSessionId(tab.command),
      status: forceDisconnected ? getDisconnectedStatus(tab.status) : tab.status,
      terminalModes: tab.terminalModes,
      title: tab.title,
      viewport: tab.viewport,
      workerName: tab.workerName,
      workspaceId: tab.workspaceId,
    }))
  return pruneOrphanedTabs(restored, options.validWorkspaceIds)
}

export function restoreLayoutTrees(
  snapshot: ProjectSnapshotV1 | undefined,
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
        for (const leafId of allTabIds(pruned)) {
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
      for (const leafId of allTabIds(pruned)) {
        tabGroupMap[leafId] = gId
      }
    }
  }

  return { layoutTrees, tabGroupMap }
}

// When a workspace is removed, its tabs are killed live via disposeWorkspaceTabs
// — but the project's persisted projectSnapshot still references them by
// workspaceId. Without this pruning, a subsequent load-project (project switch
// or restart) resurrects the dead tabs and they reappear in h-l navigation.
export function pruneSnapshotOfWorkspace(
  snapshot: ProjectSnapshotV1 | undefined,
  workspaceId: string
): ProjectSnapshotV1 | undefined {
  if (!snapshot) return snapshot
  const keptTabs = snapshot.tabs.filter((tab) => tab.workspaceId !== workspaceId)
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
        for (const leafId of allTabIds(pruned)) {
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

export function restoreProjectState(
  state: AppState,
  projectSnapshot: ProjectSnapshotV1 | undefined,
  options: RestoreOptions = {}
): Pick<AppState, 'tabs' | 'activeTabId' | 'focusMode' | 'layoutTrees' | 'tabGroupMap'> &
  Partial<Pick<AppState, 'lastActiveTabByWorkspace'>> {
  const tabs = restoreTabsFromProject(projectSnapshot, options)
  const activeTabId =
    projectSnapshot?.activeTabId != null &&
    projectSnapshot?.activeTabId !== '' &&
    tabs.some((tab) => tab.id === projectSnapshot.activeTabId)
      ? projectSnapshot.activeTabId
      : (tabs[0]?.id ?? null)

  const { layoutTrees, tabGroupMap } = restoreLayoutTrees(projectSnapshot, tabs)
  const orderedTabs = normalizeGroupedTabOrder(tabs, layoutTrees, tabGroupMap)

  // Dormant until the gate flips: merge the persisted per-workspace memory over
  // the live in-memory map. While off, the key is omitted entirely so callers
  // that spread the result never overwrite their existing map on a switch.
  const persistedLastActiveTab =
    RESTORE_LAST_ACTIVE_TAB_BY_WORKSPACE && projectSnapshot?.lastActiveTabByWorkspace
      ? { ...state.lastActiveTabByWorkspace, ...projectSnapshot.lastActiveTabByWorkspace }
      : undefined

  return {
    activeTabId,
    focusMode: 'navigation',
    layoutTrees,
    tabGroupMap,
    tabs: orderedTabs,
    ...(persistedLastActiveTab ? { lastActiveTabByWorkspace: persistedLastActiveTab } : {}),
  }
}
