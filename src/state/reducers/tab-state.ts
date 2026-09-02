import type { AppAction } from '../actions'
import type { AppState, TabSession } from '../types'

import {
  allTabIds,
  createGroupId,
  createLeaf,
  createPluginLeaf,
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
  clearWorkspaceDone,
  filterTabsForActiveWorkspace,
  orderTabsByWorkspace,
  withActiveWorkspace,
} from '../project-workspaces'
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
      const adjacentIds = new Set(allTabIds(adjacentTree))
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
      const adjacentIds = new Set(allTabIds(adjacentTree))
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

function withActiveTabWorkspace(
  state: AppState,
  tabId: string | null,
  opts?: { onlyIfMissing?: boolean }
): AppState {
  if (tabId == null || tabId === '') return state
  // Opening the tab is reading its notification, whatever else this helper
  // decides about the workspace. Every path that makes a tab the active one
  // goes through here.
  const seen = { ...state, tabs: clearTabUnseen(state.tabs, tabId) }
  if (!(seen.currentProjectId != null && seen.currentProjectId !== '')) return seen
  const tab = seen.tabs.find((entry) => entry.id === tabId)
  if (!(tab?.workspaceId != null && tab?.workspaceId !== '')) return seen
  const workspaceId = tab.workspaceId
  // Opening one of a workspace's tabs is seeing that workspace, so it drops the
  // finished-a-turn tick — otherwise a background tab finishing in the workspace
  // you are already in leaves a ✓ that only a workspace switch could clear.
  const workspaceActivity = clearWorkspaceDone(seen.workspaceActivity, workspaceId)
  // When `onlyIfMissing` is set, we leave the project's workspace alone if it
  // already points at a known workspace. Used by `hydrate-project` so that
  // a backend re-attach after a user-initiated workspace switch (j/k cycling)
  // doesn't clobber the freshly chosen workspace by re-syncing from the
  // restored active tab.
  if (opts?.onlyIfMissing === true) {
    const project = seen.projects.find((entry) => entry.id === seen.currentProjectId)
    const hasValidWorkspace =
      project?.activeWorkspaceId != null &&
      project.activeWorkspaceId !== '' &&
      (project.workspaces?.some((w) => w.id === project.activeWorkspaceId) ?? false)
    if (hasValidWorkspace) return { ...seen, workspaceActivity }
  }
  return {
    ...seen,
    projects: seen.projects.map((project) =>
      project.id === seen.currentProjectId ? withActiveWorkspace(project, workspaceId) : project
    ),
    workspaceActivity,
  }
}

/**
 * Drop one tab's unseen mark. Returns the same array when it holds none, so a
 * caller can run it on every activation without re-rendering the tab list.
 */
function clearTabUnseen(tabs: TabSession[], tabId: string): TabSession[] {
  if (!tabs.some((tab) => tab.id === tabId && tab.unseen === true)) return tabs
  return tabs.map((tab) => (tab.id === tabId ? { ...tab, unseen: undefined } : tab))
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
    // Positional fallbacks must skip hidden tabs: landing `activeTabId` on one
    // would render a pane the user cannot see in any tab bar.
    const positional = [tabs[indexToClose], tabs[indexToClose - 1]].find(
      (tab) => tab !== undefined && tab.hidden !== true
    )
    nextActiveTabId = layoutNeighbor ?? positional?.id ?? null
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

  return withActiveTabWorkspace(
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
      // A hidden tab is chrome-invisible, so adding it must be invisible too:
      // no focus steal, no modal dismissal, and — critically — no workspace
      // re-sync, which would teleport a user sitting on another workspace.
      if (newTab.hidden === true) {
        return { ...state, tabs: [...state.tabs, newTab] }
      }
      return withActiveTabWorkspace(
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
      // The project's activeWorkspaceId may have just been switched by the
      // user (j/k cycle, sidebar click) before the backend attached. Honor
      // that choice by only considering tabs visible in that workspace —
      // otherwise we'd land the active tab on whatever the backend picked
      // (typically the workspace we *last* persisted, not the current one).
      const currentProject =
        state.currentProjectId != null && state.currentProjectId !== ''
          ? state.projects.find((s) => s.id === state.currentProjectId)
          : undefined
      // The daemon rebuilds `command` as `[command, ...args].join(' ')` and has
      // no `sessionId` on the wire at all. Adopting its tabs wholesale bakes this
      // spawn's `--session-id <uuid>` into the string the *next* spawn parses —
      // claude exits on "Session ID … is already in use" and takes the tab with
      // it — and drops the id the resume depends on. Both fields belong to the
      // client, so keep what it already holds for the tabs it knows.
      const ownedById = new Map(state.tabs.map((entry) => [entry.id, entry]))
      const hydratedTabs = action.tabs.map((entry) => {
        const owned = ownedById.get(entry.id)
        return owned ? { ...entry, command: owned.command, sessionId: owned.sessionId } : entry
      })
      const visibleForWorkspace = filterTabsForActiveWorkspace(hydratedTabs, currentProject)
      const visibleIds = new Set(visibleForWorkspace.map((t) => t.id))
      const hydratedActiveTabId =
        action.activeTabId != null &&
        action.activeTabId !== '' &&
        visibleIds.has(action.activeTabId)
          ? action.activeTabId
          : (visibleForWorkspace[0]?.id ?? null)
      const tabIds = new Set(hydratedTabs.map((t) => t.id))

      // Restore from new multi-tree format or migrate from legacy single tree
      const hydratedTrees: Record<string, LayoutNode> = {}
      const hydratedGroupMap: Record<string, string> = {}

      if (action.layoutTrees && action.tabGroupMap) {
        // New format: prune each group tree
        for (const [gId, tree] of Object.entries(action.layoutTrees)) {
          const pruned = pruneLayoutTree(tree, tabIds)
          if (pruned && pruned.type === 'split') {
            hydratedTrees[gId] = pruned
            for (const leafId of allTabIds(pruned)) {
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
          for (const leafId of allTabIds(pruned)) {
            hydratedGroupMap[leafId] = gId
          }
        }
      }

      return withActiveTabWorkspace(
        {
          ...state,
          activeTabId: hydratedActiveTabId,
          focusMode: 'navigation',
          layoutTrees: hydratedTrees,
          tabGroupMap: hydratedGroupMap,
          tabs: normalizeGroupedTabOrder(hydratedTabs, hydratedTrees, hydratedGroupMap),
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
      return withActiveTabWorkspace({ ...state, activeTabId: action.tabId }, action.tabId)
    case 'move-active-tab': {
      if (state.tabs.length === 0) {
        return state
      }
      const project = getCurrentProject(state)
      const visibleTabs = filterTabsForActiveWorkspace(state.tabs, project)
      if (visibleTabs.length === 0) {
        return state
      }
      const orderedTabs = orderTabsByWorkspace(visibleTabs, project)
      const currentIndex = orderedTabs.findIndex((tab) => tab.id === state.activeTabId)
      const safeIndex = currentIndex === -1 ? 0 : currentIndex
      const nextIndex = (safeIndex + action.delta + orderedTabs.length) % orderedTabs.length
      const nextTabId = orderedTabs[nextIndex]?.id
      return nextTabId == null || nextTabId === '' || nextTabId === state.activeTabId
        ? state
        : withActiveTabWorkspace({ ...state, activeTabId: nextTabId }, nextTabId)
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
      const layoutIds = activeGroupTree ? allTabIds(activeGroupTree) : []
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

      // Standalone tab reorder. Step over hidden tabs rather than swapping with
      // one: the swap would look like a dead keypress and shuffle the hidden
      // tab out of its append-order slot.
      let nextIndex = activeIndex + action.delta
      const step = action.delta < 0 ? -1 : 1
      while (state.tabs[nextIndex]?.hidden === true) {
        nextIndex += step
      }
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
        const targetIds = new Set(allTabIds(targetTree))
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
      // occupy in `state.tabs`, leaving tabs from other workspaces anchored in
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
      return withActiveTabWorkspace(
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
            hibernated: undefined,
            status: 'starting',
            terminalModes: createDefaultTerminalModes(),
            viewport: undefined,
          })),
        },
        action.tabId
      )
    case 'hibernate-tab':
      // Deliberately keeps `buffer` and `viewport`: the frozen screen is the
      // whole point — you should still see what the assistant last said. That is
      // the one thing separating this from `reset-tab-project`, which wipes both
      // because it is about to draw a live PTY over them.
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          activity: 'idle',
          hibernated: true,
          status: 'disconnected',
        })),
      }
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
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          activity: action.activity,
          // Back to work: whatever it wanted to tell you is out of date.
          unseen:
            action.activity === 'working' || action.activity === 'waiting-input'
              ? undefined
              : tab.unseen,
        })),
      }
    case 'mark-tab-unseen':
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({ ...tab, unseen: true })),
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
          hidden: action.hidden ?? tab.hidden,
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

      const newTree = splitNode(tree, state.activeTabId, action.direction, createLeaf(newTab.id))

      // Insert newTab right after the last layout group member
      const layoutIdSet = new Set(allTabIds(tree))
      let insertIndex = state.tabs.length
      for (let i = state.tabs.length - 1; i >= 0; i--) {
        const tabId = getTabIdAtIndex(state.tabs, i)
        if (tabId != null && tabId !== '' && layoutIdSet.has(tabId)) {
          insertIndex = i + 1
          break
        }
      }
      const tabs = [...state.tabs.slice(0, insertIndex), newTab, ...state.tabs.slice(insertIndex)]

      return withActiveTabWorkspace(
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
    case 'open-plugin-pane': {
      if (!(state.activeTabId != null && state.activeTabId !== '')) {
        return state
      }
      // One instance per registered pane. Opening an open pane is a no-op
      // rather than a second copy: the id is the plugin's name for it, and two
      // panes claiming it would make "close it" ambiguous.
      if (state.tabGroupMap[action.paneId] !== undefined) {
        return state
      }

      let paneGroupId = getGroupIdForTab(state.tabGroupMap, state.activeTabId)
      const existing =
        paneGroupId != null && paneGroupId !== '' ? state.layoutTrees[paneGroupId] : undefined
      let paneTree: LayoutNode
      if (paneGroupId != null && paneGroupId !== '' && existing) {
        paneTree = existing
      } else {
        paneGroupId = createGroupId()
        paneTree = createLeaf(state.activeTabId)
      }

      const withPane = splitNode(
        paneTree,
        state.activeTabId,
        action.direction,
        createPluginLeaf(action.paneId)
      )
      if (withPane === paneTree) {
        return state
      }

      // The active tab does not change: a plugin pane cannot hold focus, so
      // opening one beside a terminal must not take the keyboard away from it.
      return {
        ...state,
        layoutTrees: { ...state.layoutTrees, [paneGroupId]: withPane },
        tabGroupMap: {
          ...state.tabGroupMap,
          [action.paneId]: paneGroupId,
          [state.activeTabId]: paneGroupId,
        },
      }
    }
    case 'close-plugin-pane': {
      const closeGroupId = state.tabGroupMap[action.paneId]
      const closeTree =
        closeGroupId != null && closeGroupId !== '' ? state.layoutTrees[closeGroupId] : undefined
      if (closeGroupId == null || closeGroupId === '' || !closeTree) {
        return state
      }

      const remaining = removeNode(closeTree, action.paneId)
      const nextTrees = { ...state.layoutTrees }
      const nextGroupMap = { ...state.tabGroupMap }
      delete nextGroupMap[action.paneId]
      // A group that is down to one pane is not a split any more, and the
      // surviving tab goes back to being an ordinary tab — the same collapse
      // closing a tab performs.
      if (remaining === null || remaining.type === 'leaf') {
        delete nextTrees[closeGroupId]
        if (remaining?.type === 'leaf') delete nextGroupMap[remaining.tabId]
      } else {
        nextTrees[closeGroupId] = remaining
      }

      return { ...state, layoutTrees: nextTrees, tabGroupMap: nextGroupMap }
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
      return withActiveTabWorkspace({ ...state, activeTabId: neighbor }, neighbor)
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
