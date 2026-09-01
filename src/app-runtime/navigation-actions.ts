import type { AppState } from '../state/types'
import type { SideEffectContext } from './side-effect-context'

import { logInputDebug } from '../debug/input-log'
import { appStore } from '../state/app-store'
import { saveProjectCatalog } from '../state/project-catalog'
import {
  filterTabsForActiveWorkspace,
  getPrimaryWorkspace,
  getSidebarWorkspaces,
  withActiveWorkspace,
} from '../state/project-workspaces'
import { appReducer } from '../state/store'
import { buildTabEntries } from '../state/tab-entries'
import { switchProjectRecords } from './project-actions'

export function handleSwitchProjectByIndex(
  ctx: SideEffectContext,
  index: number,
  workspaceId?: string
): void {
  const { backend, dispatch } = ctx
  // Read fresh state. ctx.state is the snapshot from the previous render and
  // lags behind dispatches that happened in the same JS turn.
  const state = ctx.getState()
  const ordered = [...state.projects].sort(
    (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
  )
  const target = ordered[index - 1]
  if (!target) {
    logInputDebug('app.projectBar.switchOutOfRange', { index, total: ordered.length })
    return
  }

  // Resolve which workspace to land on. If the caller passed an explicit
  // `workspaceId` (project-row tap → its primary, workspace-row tap → that
  // workspace), honor it; otherwise let the target project keep its persisted
  // activeWorkspaceId.
  const resolvedWorkspaceId =
    workspaceId != null &&
    workspaceId !== '' &&
    (target.workspaces?.some((w) => w.id === workspaceId) ?? false)
      ? workspaceId
      : undefined
  const needsWorkspaceChange =
    resolvedWorkspaceId != null && resolvedWorkspaceId !== target.activeWorkspaceId

  if (target.id === state.currentProjectId) {
    if (needsWorkspaceChange) {
      dispatch({
        projectId: target.id,
        type: 'set-active-workspace',
        workspaceId: resolvedWorkspaceId,
      })
    }
    if (state.focusMode === 'git') {
      dispatch({ type: 'exit-git-mode' })
    }
    return
  }

  // Cross-project: bundle the workspace change into the project record AND
  // fold set-projects + load-project into a SINGLE setState call. Otherwise
  // any subscriber notification (re-render, useEffect, backend re-attach)
  // between dispatches can re-assert the project's previously-persisted
  // activeWorkspaceId, dropping the user back on the last-visited workspace.
  const patchedProject = needsWorkspaceChange
    ? withActiveWorkspace(target, resolvedWorkspaceId)
    : target
  const patchedState: AppState = needsWorkspaceChange
    ? {
        ...state,
        projects: state.projects.map((s) => (s.id === patchedProject.id ? patchedProject : s)),
      }
    : state
  const projects = switchProjectRecords(patchedState, patchedProject)
  saveProjectCatalog(projects)
  void backend.destroy(true)
  appStore.setState((current) => {
    const afterSet = appReducer(current, { projects, type: 'set-projects' })
    return appReducer(afterSet, {
      forceDisconnected: false,
      projectId: patchedProject.id,
      projectSnapshot: patchedProject.projectSnapshot,
      type: 'load-project',
    })
  })
}

/**
 * One stop for `j`/`k`, and it is always a workspace — the project's own row is
 * a heading, not a destination. Every project owns a primary (every path into
 * the catalog runs `ensureProjectWorkspaces`), so no project can be skipped by
 * having nothing to land on.
 */
interface SidebarItem {
  projectId: string
  workspaceId: string
}

function buildSidebarItems(state: AppState): SidebarItem[] {
  const ordered = [...state.projects].sort(
    (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
  )
  const items: SidebarItem[] = []
  for (const project of ordered) {
    // `true`, for every project: a folded one keeps exactly the row j/k would
    // land on, and that row is on screen the moment the cursor gets there.
    for (const workspace of getSidebarWorkspaces(project, true)) {
      items.push({ projectId: project.id, workspaceId: workspace.id })
    }
  }
  return items
}

function findCurrentSidebarItem(state: AppState, items: SidebarItem[]): number {
  const projectId = state.currentProjectId
  if (projectId == null || projectId === '') return -1
  const project = state.projects.find((s) => s.id === projectId)
  // An unset active workspace means the project sits on its checkout, which now
  // has a row of its own to land on.
  const activeWorkspaceId =
    project?.activeWorkspaceId ?? getPrimaryWorkspace(project?.workspaces)?.id
  if (activeWorkspaceId == null || activeWorkspaceId === '') return -1
  return items.findIndex(
    (item) => item.projectId === projectId && item.workspaceId === activeWorkspaceId
  )
}

export function handleCycleSidebarItem(ctx: SideEffectContext, direction: 1 | -1): void {
  const { backend, dispatch } = ctx
  // Read fresh from the store, not ctx.state (which is a per-render
  // snapshot). Rapid key presses fire before React re-renders, so ctx.state
  // can lag the actual store.
  const state = appStore.getState()
  const items = buildSidebarItems(state)
  if (items.length === 0) return
  const currentIdx = findCurrentSidebarItem(state, items)
  // If we don't know the current, jump to first/last depending on direction.
  let startIdx: number
  if (currentIdx >= 0) {
    startIdx = currentIdx
  } else {
    startIdx = direction === 1 ? -1 : 0
  }
  const len = items.length
  const target = items[(((startIdx + direction) % len) + len) % len]
  if (!target) return

  const project = state.projects.find((s) => s.id === target.projectId)
  if (!project) return

  const targetWorkspaceId = target.workspaceId
  const isCrossProject = project.id !== state.currentProjectId
  const needsWorkspaceChange = targetWorkspaceId !== project.activeWorkspaceId

  if (isCrossProject) {
    // Bundle the workspace change into the project record AND fold the
    // project switch's two dispatches (set-projects + load-project) into a
    // SINGLE Zustand setState call — otherwise each dispatch fires a
    // separate subscription notification and the @opentui/react reconciler
    // paints an intermediate frame where the new project is current but
    // the old activeWorkspaceId still holds, producing the visible flicker.
    const patchedProject = needsWorkspaceChange
      ? withActiveWorkspace(project, targetWorkspaceId)
      : project
    const patchedState: AppState = needsWorkspaceChange
      ? {
          ...state,
          projects: state.projects.map((s) => (s.id === patchedProject.id ? patchedProject : s)),
        }
      : state
    const projects = switchProjectRecords(patchedState, patchedProject)
    saveProjectCatalog(projects)
    void backend.destroy(true)
    appStore.setState((current) => {
      const afterSet = appReducer(current, { projects, type: 'set-projects' })
      return appReducer(afterSet, {
        // Daemon is alive and attach() will hydrate real statuses within a
        // frame, so skip the snapshot's running→disconnected downgrade —
        // otherwise the "Restored snapshot" hint flashes on every j/k cycle.
        forceDisconnected: false,
        projectId: patchedProject.id,
        projectSnapshot: patchedProject.projectSnapshot,
        type: 'load-project',
      })
    })
    return
  }

  if (needsWorkspaceChange) {
    dispatch({
      projectId: project.id,
      type: 'set-active-workspace',
      workspaceId: targetWorkspaceId,
    })
  }
}

export function handleSwitchTabByIndex(ctx: SideEffectContext, index: number): void {
  const { dispatch, state } = ctx
  const currentProject =
    state.currentProjectId != null && state.currentProjectId !== ''
      ? state.projects.find((s) => s.id === state.currentProjectId)
      : undefined
  const visible = filterTabsForActiveWorkspace(state.tabs, currentProject)
  const entries = buildTabEntries(visible, state.layoutTrees, state.tabGroupMap, state.activeTabId)
  const target = entries[index - 1]
  if (!target) {
    logInputDebug('app.tabBar.switchOutOfRange', { index, total: entries.length })
    return
  }
  const targetTabId = target.kind === 'single' ? target.tab.id : target.activeLeafId
  if (targetTabId === state.activeTabId) return
  dispatch({ tabId: targetTabId, type: 'set-active-tab' })
}
