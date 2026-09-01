import type { AppAction } from '../actions'
import type { AppState } from '../types'

import { moveIdToIdPosition, orderProjectsForDisplay } from '../../ui/project-ordering'
import { restoreProjectState } from '../project-persistence'
import { clearWorkspaceDone, withActiveWorkspace } from '../project-workspaces'
import { filterProjects } from '../selectors'
import { filterTabsForActiveWorkspace } from '../tab-entries'
// eslint-disable-next-line no-duplicate-imports
import { IDLE_WORKSPACE_ACTIVITY } from '../types'

const CLOSED_MODAL = {
  editBuffer: null,
  projectTargetId: null,
  selectedIndex: 0,
  type: null,
} as const

export function reduceProjectState(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'load-project': {
      const snapshot =
        action.projectSnapshot ??
        state.projects.find((entry) => entry.id === action.projectId)?.projectSnapshot
      // The project's activeWorkspaceId may have been patched right before
      // this load (e.g. the cross-project branch of handleCycleSidebarItem
      // sets it to the workspace the user just clicked). The snapshot's
      // activeTabId still reflects the *last* workspace they were on, so
      // honor the patched workspace by filtering the restored tab list.
      const loadedProject = state.projects.find((entry) => entry.id === action.projectId)
      const loadedWorkspaces = loadedProject?.workspaces ?? []
      const restored = restoreProjectState(state, snapshot, {
        forceDisconnected: action.forceDisconnected ?? true,
        // Drop tabs bound to workspaces this project no longer owns so a stale
        // id can't be caught by a later workspace delete (closing "another
        // workspace's" tabs) and so corrupted catalogs self-heal on load. Only
        // prune once the project has workspaces — an empty list means it hasn't
        // been initialized yet, and pruning then would wrongly drop bound tabs.
        validWorkspaceIds:
          loadedWorkspaces.length > 0 ? new Set(loadedWorkspaces.map((w) => w.id)) : undefined,
      })
      const visible = filterTabsForActiveWorkspace(restored.tabs, loadedProject)
      // Prefer the snapshot's tab; if it isn't visible under the active
      // workspace (e.g. a multi-workspace project restored onto a different
      // workspace), fall back to the last tab we viewed in that workspace,
      // then to the first visible tab.
      const rememberedForWorkspace =
        loadedProject?.activeWorkspaceId != null && loadedProject.activeWorkspaceId !== ''
          ? state.lastActiveTabByWorkspace[loadedProject.activeWorkspaceId]
          : undefined
      const snapshotTabVisible =
        restored.activeTabId != null &&
        restored.activeTabId !== '' &&
        visible.some((t) => t.id === restored.activeTabId)
      const rememberedTabVisible =
        rememberedForWorkspace != null &&
        rememberedForWorkspace !== '' &&
        visible.some((t) => t.id === rememberedForWorkspace)
      const fallbackTabId = rememberedTabVisible ? rememberedForWorkspace : (visible[0]?.id ?? null)
      const activeTabId = snapshotTabVisible ? restored.activeTabId : fallbackTabId
      return {
        ...state,
        ...restored,
        activeTabId,
        currentProjectId: action.projectId,
        focusMode: 'navigation',
        modal: CLOSED_MODAL,
        projects: state.projects.map((entry) =>
          entry.id === action.projectId
            ? {
                ...entry,
                lastOpenedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : entry
        ),
        // Landing on a project lands on its active workspace — same rule as
        // `set-active-workspace`: you have seen it, so the tick goes.
        workspaceActivity: clearWorkspaceDone(
          state.workspaceActivity,
          loadedProject?.activeWorkspaceId
        ),
      }
    }
    case 'set-projects':
      return { ...state, projects: action.projects }
    case 'create-project-record':
      return {
        ...state,
        currentProjectId: action.project.id,
        focusMode: 'navigation',
        modal: CLOSED_MODAL,
        projects: [...state.projects, action.project],
      }
    case 'rename-project-record':
      return {
        ...state,
        projects: state.projects.map((project) =>
          project.id === action.projectId
            ? { ...project, name: action.name, updatedAt: new Date().toISOString() }
            : project
        ),
      }
    case 'delete-project-record': {
      const deletingCurrent = action.projectId === state.currentProjectId
      const newProjects = state.projects.filter((project) => project.id !== action.projectId)
      const nextStatuses = { ...state.projectStatuses }
      delete nextStatuses[action.projectId]
      if (action.openProjectPicker === true) {
        const filteredNew = filterProjects(newProjects, state.modal.editBuffer)
        const maxIndex = filteredNew.length
        const clampedIndex = Math.min(state.modal.selectedIndex, maxIndex)
        return {
          ...state,
          activeTabId: deletingCurrent ? null : state.activeTabId,
          currentProjectId: deletingCurrent ? null : state.currentProjectId,
          focusMode: 'modal',
          modal: {
            editBuffer: null,
            projectTargetId: null,
            selectedIndex: clampedIndex,
            type: 'project-picker',
          },
          projects: newProjects,
          projectStatuses: nextStatuses,
          tabs: deletingCurrent ? [] : state.tabs,
        }
      }
      return {
        ...state,
        activeTabId: deletingCurrent ? null : state.activeTabId,
        currentProjectId: deletingCurrent ? null : state.currentProjectId,
        focusMode: deletingCurrent ? 'navigation' : state.focusMode,
        modal: deletingCurrent ? CLOSED_MODAL : state.modal,
        projects: newProjects,
        projectStatuses: nextStatuses,
        tabs: deletingCurrent ? [] : state.tabs,
      }
    }
    case 'reorder-projects': {
      const byId = new Map(state.projects.map((s) => [s.id, s]))
      const ordered: typeof state.projects = []
      let idx = 0
      for (const id of action.orderedIds) {
        const s = byId.get(id)
        if (s) {
          ordered.push({ ...s, order: idx })
          byId.delete(id)
        }
        idx++
      }
      let nextOrder = ordered.length
      for (const s of byId.values()) {
        ordered.push({ ...s, order: nextOrder++ })
      }
      return { ...state, projects: ordered }
    }
    case 'reorder-active-project': {
      const currentId = state.currentProjectId
      if (currentId == null || currentId === '') return state
      const ids = orderProjectsForDisplay(state.projects).map((s) => s.id)
      const from = ids.indexOf(currentId)
      if (from < 0) return state
      const to = from + action.delta
      const targetId = ids[to]
      if (targetId == null) return state
      const nextIds = moveIdToIdPosition(ids, currentId, targetId)
      const byId = new Map(state.projects.map((s) => [s.id, s]))
      const nextProjects = nextIds.map((id, idx) => {
        const s = byId.get(id)
        return s ? { ...s, order: idx } : s
      })
      const filtered = nextProjects.filter((s): s is NonNullable<typeof s> => s != null)
      if (filtered.length !== state.projects.length) return state
      return { ...state, projects: filtered }
    }
    case 'set-project-status': {
      const prev = state.projectStatuses[action.projectId]
      if (
        prev !== undefined &&
        prev.working === action.status.working &&
        prev.waiting === action.status.waiting
      ) {
        return state
      }
      return {
        ...state,
        projectStatuses: { ...state.projectStatuses, [action.projectId]: action.status },
      }
    }
    case 'set-workspace-activity': {
      const prev = state.workspaceActivity[action.workspaceId] ?? IDLE_WORKSPACE_ACTIVITY
      // Going back to work is the other way a "finished, unseen" tick clears:
      // the workspace has something newer to say than "it ended a turn once".
      const done = action.working || action.waiting ? false : prev.done
      if (
        prev.working === action.working &&
        prev.waiting === action.waiting &&
        prev.done === done
      ) {
        return state
      }
      return {
        ...state,
        workspaceActivity: {
          ...state.workspaceActivity,
          [action.workspaceId]: { done, waiting: action.waiting, working: action.working },
        },
      }
    }
    case 'mark-workspace-done': {
      const prev = state.workspaceActivity[action.workspaceId] ?? IDLE_WORKSPACE_ACTIVITY
      if (prev.done) return state
      return {
        ...state,
        workspaceActivity: {
          ...state.workspaceActivity,
          [action.workspaceId]: { ...prev, done: true },
        },
      }
    }
    case 'add-workspace-record':
      return {
        ...state,
        projects: state.projects.map((project) => {
          if (project.id !== action.projectId) return project
          const next = {
            ...project,
            activeWorkspaceId:
              action.activate === true ? action.workspace.id : project.activeWorkspaceId,
            updatedAt: new Date().toISOString(),
            workspaces: [...(project.workspaces ?? []), action.workspace],
          }
          return next.activeWorkspaceId != null && next.activeWorkspaceId !== ''
            ? next
            : withActiveWorkspace(next, action.workspace.id)
        }),
      }
    case 'set-active-workspace': {
      const projects = state.projects.map((project) =>
        project.id === action.projectId ? withActiveWorkspace(project, action.workspaceId) : project
      )
      // Remember the tab we're leaving so coming back to this workspace later
      // restores it instead of snapping to the first tab. Keyed by the
      // workspace we're departing (the current project's active one).
      const workspaceActivity = clearWorkspaceDone(state.workspaceActivity, action.workspaceId)
      const leavingProject = state.projects.find((s) => s.id === action.projectId)
      const leavingWorkspaceId = leavingProject?.activeWorkspaceId
      const lastActiveTabByWorkspace =
        action.projectId === state.currentProjectId &&
        leavingWorkspaceId != null &&
        leavingWorkspaceId !== '' &&
        state.activeTabId != null &&
        state.activeTabId !== ''
          ? { ...state.lastActiveTabByWorkspace, [leavingWorkspaceId]: state.activeTabId }
          : state.lastActiveTabByWorkspace
      // Changing the workspace of a non-current project has no effect on
      // which tab the user is looking at — leave activeTabId alone.
      if (action.projectId !== state.currentProjectId) {
        return { ...state, lastActiveTabByWorkspace, projects, workspaceActivity }
      }
      // For the current project: if the existing activeTabId belongs to
      // the new workspace, keep it. Otherwise restore the last tab we viewed
      // in that workspace, falling back to the first visible tab (or clearing
      // it if the workspace is empty — the pane then renders the "this
      // workspace has no tabs" placeholder).
      const updated = projects.find((s) => s.id === action.projectId)
      const visible = filterTabsForActiveWorkspace(state.tabs, updated)
      const currentStillVisible =
        state.activeTabId != null &&
        state.activeTabId !== '' &&
        visible.some((t) => t.id === state.activeTabId)
      if (currentStillVisible) {
        return { ...state, lastActiveTabByWorkspace, projects, workspaceActivity }
      }
      const remembered = lastActiveTabByWorkspace[action.workspaceId]
      const nextActiveTabId =
        remembered != null && remembered !== '' && visible.some((t) => t.id === remembered)
          ? remembered
          : (visible[0]?.id ?? null)
      return {
        ...state,
        activeTabId: nextActiveTabId,
        lastActiveTabByWorkspace,
        projects,
        workspaceActivity,
      }
    }
    case 'update-workspace-record':
      return {
        ...state,
        projects: state.projects.map((project) =>
          project.id === action.projectId
            ? {
                ...project,
                updatedAt: new Date().toISOString(),
                workspaces: project.workspaces?.map((workspace) =>
                  workspace.id === action.workspaceId
                    ? { ...workspace, ...action.patch, updatedAt: new Date().toISOString() }
                    : workspace
                ),
              }
            : project
        ),
      }
    default:
      return null
  }
}
