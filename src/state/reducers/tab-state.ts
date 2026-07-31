import type { AppAction, AppState, TabSession } from '../types'

import {
  allLeafIds,
  createGroupId,
  createLeaf,
  getAdjacentLeaf,
  getGroupIdForTab,
  getTreeForTab,
  type LayoutNode,
  pruneLayoutTree,
  removeNode,
  resizeSplit,
  setSplitRatio,
  splitNode,
} from '../layout-tree'
import { normalizeGroupedTabOrder } from '../project-persistence'
import {
  filterTabsForActiveWorktree,
  orderTabsByWorktree,
  withActiveWorktree,
} from '../project-worktrees'
import { createDefaultTerminalModes } from '../terminal-modes'

const MAX_BUFFER_LENGTH = 50_000

function clampBuffer(buffer: string): string {
  return buffer.length <= MAX_BUFFER_LENGTH
    ? buffer
    : buffer.slice(buffer.length - MAX_BUFFER_LENGTH)
}

function getTabIdAtIndex(tabs: TabSession[], index: number): string | undefined {
  return tabs[index]?.id
}

function findContiguousGroupRange(
  tabs: TabSession[],
  layoutIds: Set<string>,
  activeIndex: number
): { groupStart: number; groupEnd: number } {
  let groupStart = activeIndex
  let groupEnd = activeIndex

  while (groupStart > 0 && layoutIds.has(getTabIdAtIndex(tabs, groupStart - 1) ?? '')) {
    groupStart--
  }

  while (groupEnd < tabs.length - 1 && layoutIds.has(getTabIdAtIndex(tabs, groupEnd + 1) ?? '')) {
    groupEnd++
  }

  return { groupEnd, groupStart }
}

function moveStandaloneTab(
  tabs: TabSession[],
  activeIndex: number,
  nextIndex: number
): TabSession[] | null {
  const current = tabs[activeIndex]
  const target = tabs[nextIndex]
  if (!current || !target) {
    return null
  }

  const nextTabs = [...tabs]
  nextTabs[activeIndex] = target
  nextTabs[nextIndex] = current
  return nextTabs
}

function moveTabAcrossTargetGroup(
  tabs: TabSession[],
  activeIndex: number,
  nextIndex: number,
  targetIds: Set<string>,
  delta: number
): TabSession[] | null {
  const nextTabs = [...tabs]

  if (delta > 0) {
    let targetEnd = nextIndex
    while (
      targetEnd < nextTabs.length - 1 &&
      targetIds.has(getTabIdAtIndex(nextTabs, targetEnd + 1) ?? '')
    ) {
      targetEnd++
    }
    const moved = nextTabs.splice(activeIndex, 1)[0]
    if (!moved) {
      return null
    }
    nextTabs.splice(targetEnd, 0, moved)
    return nextTabs
  }

  let targetStart = nextIndex
  while (targetStart > 0 && targetIds.has(getTabIdAtIndex(nextTabs, targetStart - 1) ?? '')) {
    targetStart--
  }
  const moved = nextTabs.splice(activeIndex, 1)[0]
  if (!moved) {
    return null
  }
  nextTabs.splice(targetStart, 0, moved)
  return nextTabs
}

function moveLayoutGroup(
  state: AppState,
  activeIndex: number,
  layoutIds: string[],
  delta: number
): TabSession[] | null {
  const layoutSet = new Set(layoutIds)
  const { groupEnd, groupStart } = findContiguousGroupRange(state.tabs, layoutSet, activeIndex)
  const tabs = [...state.tabs]

  if (delta > 0 && groupEnd < tabs.length - 1) {
    const adjacentId = getTabIdAtIndex(tabs, groupEnd + 1)
    if (!(adjacentId != null && adjacentId !== '')) {
      return null
    }

    const adjacentGroupId = getGroupIdForTab(state.tabGroupMap, adjacentId)
    const adjacentTree =
      adjacentGroupId != null && adjacentGroupId !== '' ? state.layoutTrees[adjacentGroupId] : null
    if (adjacentTree && adjacentTree.type === 'split') {
      const adjacentIds = new Set(allLeafIds(adjacentTree))
      let otherEnd = groupEnd + 1
      while (
        otherEnd < tabs.length - 1 &&
        adjacentIds.has(getTabIdAtIndex(tabs, otherEnd + 1) ?? '')
      ) {
        otherEnd++
      }
      const otherCount = otherEnd - groupEnd
      const moved = tabs.splice(groupEnd + 1, otherCount)
      tabs.splice(groupStart, 0, ...moved)
      return tabs
    }

    const moved = tabs.splice(groupEnd + 1, 1)[0]
    if (!moved) {
      return null
    }
    tabs.splice(groupStart, 0, moved)
    return tabs
  }

  if (delta < 0 && groupStart > 0) {
    const adjacentId = getTabIdAtIndex(tabs, groupStart - 1)
    if (!(adjacentId != null && adjacentId !== '')) {
      return null
    }

    const adjacentGroupId = getGroupIdForTab(state.tabGroupMap, adjacentId)
    const adjacentTree =
      adjacentGroupId != null && adjacentGroupId !== '' ? state.layoutTrees[adjacentGroupId] : null
    if (adjacentTree && adjacentTree.type === 'split') {
      const adjacentIds = new Set(allLeafIds(adjacentTree))
      let otherStart = groupStart - 1
      while (otherStart > 0 && adjacentIds.has(getTabIdAtIndex(tabs, otherStart - 1) ?? '')) {
        otherStart--
      }
      const otherCount = groupStart - otherStart
      const moved = tabs.splice(otherStart, otherCount)
      tabs.splice(otherStart + (groupEnd - groupStart + 1), 0, ...moved)
      return tabs
    }

    const moved = tabs.splice(groupStart - 1, 1)[0]
    if (!moved) {
      return null
    }
    tabs.splice(groupEnd, 0, moved)
    return tabs
  }

  return null
}

function updateTab(
  tabs: TabSession[],
  tabId: string,
  updater: (tab: TabSession) => TabSession
): TabSession[] {
  return tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab))
}

function getActiveIndex(state: AppState): number {
  if (!(state.activeTabId != null && state.activeTabId !== '')) {
    return -1
  }

  return state.tabs.findIndex((tab) => tab.id === state.activeTabId)
}

function getCurrentProject(state: AppState) {
  return state.currentProjectId != null && state.currentProjectId !== ''
    ? state.projects.find((project) => project.id === state.currentProjectId)
    : undefined
}

function withActiveTabWorktree(
  state: AppState,
  tabId: string | null,
  opts?: { onlyIfMissing?: boolean }
): AppState {
  if (
    tabId == null ||
    tabId === '' ||
    !(state.currentProjectId != null && state.currentProjectId !== '')
  )
    return state
  const tab = state.tabs.find((entry) => entry.id === tabId)
  if (!(tab?.worktreeId != null && tab?.worktreeId !== '')) return state
  const worktreeId = tab.worktreeId
  // When `onlyIfMissing` is set, we leave the project's worktree alone if it
  // already points at a known worktree. Used by `hydrate-project` so that
  // a backend re-attach after a user-initiated worktree switch (j/k cycling)
  // doesn't clobber the freshly chosen worktree by re-syncing from the
  // restored active tab.
  if (opts?.onlyIfMissing === true) {
    const project = state.projects.find((entry) => entry.id === state.currentProjectId)
    const hasValidWorktree =
      project?.activeWorktreeId != null &&
      project.activeWorktreeId !== '' &&
      (project.worktrees?.some((w) => w.id === project.activeWorktreeId) ?? false)
    if (hasValidWorktree) return state
  }
  return {
    ...state,
    projects: state.projects.map((project) =>
      project.id === state.currentProjectId ? withActiveWorktree(project, worktreeId) : project
    ),
  }
}

function closeTabAtIndex(state: AppState, indexToClose: number): AppState {
  if (indexToClose < 0 || indexToClose >= state.tabs.length) {
    return state
  }

  const closingTabId = state.tabs[indexToClose]?.id
  const tabs = state.tabs.filter((_, index) => index !== indexToClose)

  // Find the tree for the closing tab's group
  const groupId =
    closingTabId != null && closingTabId !== ''
      ? getGroupIdForTab(state.tabGroupMap, closingTabId)
      : null
  const groupTree = groupId != null && groupId !== '' ? (state.layoutTrees[groupId] ?? null) : null

  let nextActiveTabId: string | null
  if (state.activeTabId === closingTabId) {
    const layoutNeighbor =
      closingTabId && groupTree
        ? (getAdjacentLeaf(groupTree, closingTabId, 'right') ??
          getAdjacentLeaf(groupTree, closingTabId, 'left') ??
          getAdjacentLeaf(groupTree, closingTabId, 'down') ??
          getAdjacentLeaf(groupTree, closingTabId, 'up'))
        : null
    nextActiveTabId = layoutNeighbor ?? tabs[indexToClose]?.id ?? tabs[indexToClose - 1]?.id ?? null
  } else {
    nextActiveTabId = tabs.find((tab) => tab.id === state.activeTabId)?.id ?? null
  }

  // Update the group's tree and clean up if needed
  let newLayoutTrees = state.layoutTrees
  let newTabGroupMap = state.tabGroupMap
  if (
    closingTabId != null &&
    closingTabId !== '' &&
    groupId != null &&
    groupId !== '' &&
    groupTree
  ) {
    const newTree = removeNode(groupTree, closingTabId)
    newLayoutTrees = { ...state.layoutTrees }
    newTabGroupMap = { ...state.tabGroupMap }
    delete newTabGroupMap[closingTabId]
    if (newTree === null || newTree.type === 'leaf') {
      // Group collapsed to single leaf or empty — remove the group
      delete newLayoutTrees[groupId]
      if (newTree?.type === 'leaf') {
        delete newTabGroupMap[newTree.tabId]
      }
    } else {
      newLayoutTrees[groupId] = newTree
    }
  }

  return withActiveTabWorktree(
    {
      ...state,
      activeTabId: nextActiveTabId,
      focusMode: tabs.length === 0 ? 'navigation' : state.focusMode,
      layoutTrees: newLayoutTrees,
      tabGroupMap: newTabGroupMap,
      tabs,
    },
    nextActiveTabId
  )
}

export function reduceTabState(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'add-tab': {
      const newTab = { ...action.tab, activity: action.tab.activity ?? 'idle' }
      return withActiveTabWorktree(
        {
          ...state,
          activeTabId: newTab.id,
          focusMode: 'navigation',
          modal: { editBuffer: null, projectTargetId: null, selectedIndex: 0, type: null },
          tabs: [...state.tabs, newTab],
        },
        newTab.id
      )
    }
    case 'hydrate-project': {
      // The project's activeWorktreeId may have just been switched by the
      // user (j/k cycle, sidebar click) before the backend attached. Honor
      // that choice by only considering tabs visible in that worktree —
      // otherwise we'd land the active tab on whatever the backend picked
      // (typically the worktree we *last* persisted, not the current one).
      const currentProject =
        state.currentProjectId != null && state.currentProjectId !== ''
          ? state.projects.find((s) => s.id === state.currentProjectId)
          : undefined
      const visibleForWorktree = filterTabsForActiveWorktree(action.tabs, currentProject)
      const visibleIds = new Set(visibleForWorktree.map((t) => t.id))
      const hydratedActiveTabId =
        action.activeTabId != null &&
        action.activeTabId !== '' &&
        visibleIds.has(action.activeTabId)
          ? action.activeTabId
          : (visibleForWorktree[0]?.id ?? null)
      const tabIds = new Set(action.tabs.map((t) => t.id))

      // Restore from new multi-tree format or migrate from legacy single tree
      const hydratedTrees: Record<string, LayoutNode> = {}
      const hydratedGroupMap: Record<string, string> = {}

      if (action.layoutTrees && action.tabGroupMap) {
        // New format: prune each group tree
        for (const [gId, tree] of Object.entries(action.layoutTrees)) {
          const pruned = pruneLayoutTree(tree, tabIds)
          if (pruned && pruned.type === 'split') {
            hydratedTrees[gId] = pruned
            for (const leafId of allLeafIds(pruned)) {
              hydratedGroupMap[leafId] = gId
            }
          }
          // If pruned to a single leaf or null, discard the group
        }
      } else if (action.layoutTree) {
        // Legacy migration: single tree → single group
        const pruned = pruneLayoutTree(action.layoutTree, tabIds)
        if (pruned && pruned.type === 'split') {
          const gId = createGroupId()
          hydratedTrees[gId] = pruned
          for (const leafId of allLeafIds(pruned)) {
            hydratedGroupMap[leafId] = gId
          }
        }
      }

      return withActiveTabWorktree(
        {
          ...state,
          activeTabId: hydratedActiveTabId,
          focusMode: 'navigation',
          layoutTrees: hydratedTrees,
          tabGroupMap: hydratedGroupMap,
          tabs: normalizeGroupedTabOrder(action.tabs, hydratedTrees, hydratedGroupMap),
        },
        hydratedActiveTabId,
        { onlyIfMissing: true }
      )
    }
    case 'close-tab':
      return closeTabAtIndex(
        state,
        state.tabs.findIndex((tab) => tab.id === action.tabId)
      )
    case 'close-active-tab':
      return closeTabAtIndex(state, getActiveIndex(state))
    case 'set-active-tab':
      return withActiveTabWorktree({ ...state, activeTabId: action.tabId }, action.tabId)
    case 'move-active-tab': {
      if (state.tabs.length === 0) {
        return state
      }
      const project = getCurrentProject(state)
      const visibleTabs = filterTabsForActiveWorktree(state.tabs, project)
      if (visibleTabs.length === 0) {
        return state
      }
      const orderedTabs = orderTabsByWorktree(visibleTabs, project)
      const currentIndex = orderedTabs.findIndex((tab) => tab.id === state.activeTabId)
      const safeIndex = currentIndex === -1 ? 0 : currentIndex
      const nextIndex = (safeIndex + action.delta + orderedTabs.length) % orderedTabs.length
      const nextTabId = orderedTabs[nextIndex]?.id
      return nextTabId == null || nextTabId === '' || nextTabId === state.activeTabId
        ? state
        : withActiveTabWorktree({ ...state, activeTabId: nextTabId }, nextTabId)
    }
    case 'reorder-active-tab': {
      const activeIndex = getActiveIndex(state)
      if (activeIndex === -1) {
        return state
      }

      // Group-aware reordering: move entire layout group together
      const activeGroupId =
        state.activeTabId != null && state.activeTabId !== ''
          ? getGroupIdForTab(state.tabGroupMap, state.activeTabId)
          : null
      const activeGroupTree =
        activeGroupId != null && activeGroupId !== '' ? state.layoutTrees[activeGroupId] : null
      const layoutIds = activeGroupTree ? allLeafIds(activeGroupTree) : []
      if (
        layoutIds.length > 1 &&
        state.activeTabId != null &&
        state.activeTabId !== '' &&
        layoutIds.includes(state.activeTabId)
      ) {
        const tabs = moveLayoutGroup(state, activeIndex, layoutIds, action.delta)
        if (!tabs) {
          return state
        }

        return { ...state, tabs }
      }

      // Standalone tab reorder
      const nextIndex = activeIndex + action.delta
      if (nextIndex < 0 || nextIndex >= state.tabs.length) {
        return state
      }
      // Check if target belongs to a group → skip over the entire group
      const targetTabId = getTabIdAtIndex(state.tabs, nextIndex)
      if (!(targetTabId != null && targetTabId !== '')) {
        return state
      }
      const targetGroupId = getGroupIdForTab(state.tabGroupMap, targetTabId)
      const targetTree =
        targetGroupId != null && targetGroupId !== '' ? state.layoutTrees[targetGroupId] : null
      if (targetTree && targetTree.type === 'split') {
        const targetIds = new Set(allLeafIds(targetTree))
        const tabs = moveTabAcrossTargetGroup(
          state.tabs,
          activeIndex,
          nextIndex,
          targetIds,
          action.delta
        )
        if (!tabs) {
          return state
        }
        return { ...state, tabs }
      }
      const tabs = moveStandaloneTab(state.tabs, activeIndex, nextIndex)
      if (!tabs) {
        return state
      }
      return { ...state, tabs }
    }
    case 'reorder-tabs': {
      // Drag-and-drop reorder of the visible tab strip. `orderedTabIds` is the
      // flattened new order of the currently-visible tabs (group members already
      // expanded into contiguous runs). We only rewrite the slots those tabs
      // occupy in `state.tabs`, leaving tabs from other worktrees anchored in
      // place. Because group members arrive contiguous, splits stay intact.
      const visibleSet = new Set(action.orderedTabIds)
      const byId = new Map(state.tabs.map((tab) => [tab.id, tab]))
      let cursor = 0
      const tabs = state.tabs.map((tab) => {
        if (!visibleSet.has(tab.id)) return tab
        const nextId = action.orderedTabIds[cursor]
        cursor++
        return (nextId != null ? byId.get(nextId) : undefined) ?? tab
      })
      return { ...state, tabs }
    }
    case 'reset-tab-project':
      return withActiveTabWorktree(
        {
          ...state,
          activeTabId: action.tabId,
          focusMode: 'navigation',
          tabs: updateTab(state.tabs, action.tabId, (tab) => ({
            ...tab,
            activity: 'idle',
            buffer: '',
            errorMessage: undefined,
            exitCode: undefined,
            status: 'starting',
            terminalModes: createDefaultTerminalModes(),
            viewport: undefined,
          })),
        },
        action.tabId
      )
    case 'append-tab-buffer':
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          buffer: clampBuffer(`${tab.buffer}${action.chunk}`),
          status: tab.status === 'starting' ? 'running' : tab.status,
        })),
      }
    case 'replace-tab-viewport':
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          status: tab.status === 'starting' ? 'running' : tab.status,
          terminalModes: action.terminalModes,
          viewport: action.viewport,
        })),
      }
    case 'set-tab-activity':
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({ ...tab, activity: action.activity })),
      }
    case 'set-tab-error':
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          activity: undefined,
          buffer: clampBuffer(`${tab.buffer}${action.message}\n`),
          errorMessage: action.message,
          status: 'error',
        })),
      }
    case 'rename-tab':
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          autoRenameStatus: action.autoRenameStatus ?? tab.autoRenameStatus,
          title: action.title,
        })),
      }
    case 'update-tab-metadata':
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          autoRenameStatus: action.autoRenameStatus ?? tab.autoRenameStatus,
          title: action.title ?? tab.title,
        })),
      }
    case 'split-pane': {
      if (!(state.activeTabId != null && state.activeTabId !== '')) {
        return state
      }
      const newTab = { ...action.newTab, activity: action.newTab.activity ?? 'idle' }

      // Find existing group for active tab, or create a new one
      let groupId = getGroupIdForTab(state.tabGroupMap, state.activeTabId)
      let tree: LayoutNode
      const existingTree =
        groupId != null && groupId !== '' ? state.layoutTrees[groupId] : undefined
      if (groupId != null && groupId !== '' && existingTree) {
        tree = existingTree
      } else {
        groupId = createGroupId()
        tree = createLeaf(state.activeTabId)
      }

      const newTree = splitNode(tree, state.activeTabId, action.direction, newTab.id)

      // Insert newTab right after the last layout group member
      const layoutIdSet = new Set(allLeafIds(tree))
      let insertIndex = state.tabs.length
      for (let i = state.tabs.length - 1; i >= 0; i--) {
        const tabId = getTabIdAtIndex(state.tabs, i)
        if (tabId != null && tabId !== '' && layoutIdSet.has(tabId)) {
          insertIndex = i + 1
          break
        }
      }
      const tabs = [...state.tabs.slice(0, insertIndex), newTab, ...state.tabs.slice(insertIndex)]

      return withActiveTabWorktree(
        {
          ...state,
          activeTabId: newTab.id,
          layoutTrees: { ...state.layoutTrees, [groupId]: newTree },
          tabGroupMap: {
            ...state.tabGroupMap,
            [newTab.id]: groupId,
            [state.activeTabId]: groupId,
          },
          tabs,
        },
        newTab.id
      )
    }
    case 'close-pane': {
      const idx = state.tabs.findIndex((tab) => tab.id === action.tabId)
      return closeTabAtIndex(state, idx)
    }
    case 'focus-pane-direction': {
      if (!(state.activeTabId != null && state.activeTabId !== '')) {
        return state
      }
      const focusTree = getTreeForTab(state.layoutTrees, state.tabGroupMap, state.activeTabId)
      if (!focusTree) {
        return state
      }
      const neighbor = getAdjacentLeaf(focusTree, state.activeTabId, action.direction)
      if (!(neighbor != null && neighbor !== '')) {
        return state
      }
      return withActiveTabWorktree({ ...state, activeTabId: neighbor }, neighbor)
    }
    case 'resize-pane': {
      const resizeGroupId = getGroupIdForTab(state.tabGroupMap, action.tabId)
      const resizeTree =
        resizeGroupId != null && resizeGroupId !== '' ? state.layoutTrees[resizeGroupId] : null
      if (resizeGroupId == null || resizeGroupId === '' || !resizeTree) {
        return state
      }
      const newTree = resizeSplit(resizeTree, action.tabId, action.delta, action.axis)
      if (newTree === resizeTree) {
        return state
      }
      return { ...state, layoutTrees: { ...state.layoutTrees, [resizeGroupId]: newTree } }
    }
    case 'set-split-ratio': {
      const ratioGroupId = getGroupIdForTab(state.tabGroupMap, action.tabId)
      const ratioTree =
        ratioGroupId != null && ratioGroupId !== '' ? state.layoutTrees[ratioGroupId] : null
      if (ratioGroupId == null || ratioGroupId === '' || !ratioTree) {
        return state
      }
      const newTree = setSplitRatio(ratioTree, action.tabId, action.ratio, action.axis)
      if (newTree === ratioTree) {
        return state
      }
      return { ...state, layoutTrees: { ...state.layoutTrees, [ratioGroupId]: newTree } }
    }
    default:
      return null
  }
}
