import type { AppAction, AppState } from '../types'

import { moveIdToIdPosition, orderProjectsForDisplay } from '../../ui/project-ordering'
import { restoreWorkspaceState } from '../project-persistence'
import { filterTabsForActiveWorktree, withActiveWorktree } from '../project-worktrees'
import { filterProjects } from '../selectors'

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
        action.workspaceSnapshot ??
        state.projects.find((entry) => entry.id === action.projectId)?.workspaceSnapshot
      // The project's activeWorktreeId may have been patched right before
      // this load (e.g. the cross-workspace branch of handleCycleSidebarItem
      // sets it to the worktree the user just clicked). The snapshot's
      // activeTabId still reflects the *last* worktree they were on, so
      // honor the patched worktree by filtering the restored tab list.
      const loadedProject = state.projects.find((entry) => entry.id === action.projectId)
      const loadedWorktrees = loadedProject?.worktrees ?? []
      const restored = restoreWorkspaceState(state, snapshot, {
        forceDisconnected: action.forceDisconnected ?? true,
        // Drop tabs bound to worktrees this project no longer owns so a stale
        // id can't be caught by a later worktree delete (closing "another
        // worktree's" tabs) and so corrupted catalogs self-heal on load. Only
        // prune once the project has worktrees — an empty list means it hasn't
        // been initialized yet, and pruning then would wrongly drop bound tabs.
        validWorktreeIds:
          loadedWorktrees.length > 0 ? new Set(loadedWorktrees.map((w) => w.id)) : undefined,
      })
      const visible = filterTabsForActiveWorktree(restored.tabs, loadedProject)
      // Prefer the snapshot's tab; if it isn't visible under the active
      // worktree (e.g. a multi-worktree project restored onto a different
      // worktree), fall back to the last tab we viewed in that worktree,
      // then to the first visible tab.
      const rememberedForWorktree =
        loadedProject?.activeWorktreeId != null && loadedProject.activeWorktreeId !== ''
          ? state.lastActiveTabByWorktree[loadedProject.activeWorktreeId]
          : undefined
      const snapshotTabVisible =
        restored.activeTabId != null &&
        restored.activeTabId !== '' &&
        visible.some((t) => t.id === restored.activeTabId)
      const rememberedTabVisible =
        rememberedForWorktree != null &&
        rememberedForWorktree !== '' &&
        visible.some((t) => t.id === rememberedForWorktree)
      const fallbackTabId = rememberedTabVisible ? rememberedForWorktree : (visible[0]?.id ?? null)
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
    case 'add-worktree-record':
      return {
        ...state,
        projects: state.projects.map((project) => {
          if (project.id !== action.projectId) return project
          const next = {
            ...project,
            activeWorktreeId:
              action.activate === true ? action.worktree.id : project.activeWorktreeId,
            updatedAt: new Date().toISOString(),
            worktrees: [...(project.worktrees ?? []), action.worktree],
          }
          return next.activeWorktreeId != null && next.activeWorktreeId !== ''
            ? next
            : withActiveWorktree(next, action.worktree.id)
        }),
      }
    case 'set-active-worktree': {
      const projects = state.projects.map((project) =>
        project.id === action.projectId ? withActiveWorktree(project, action.worktreeId) : project
      )
      // Remember the tab we're leaving so coming back to this worktree later
      // restores it instead of snapping to the first tab. Keyed by the
      // worktree we're departing (the current project's active one).
      const leavingProject = state.projects.find((s) => s.id === action.projectId)
      const leavingWorktreeId = leavingProject?.activeWorktreeId
      const lastActiveTabByWorktree =
        action.projectId === state.currentProjectId &&
        leavingWorktreeId != null &&
        leavingWorktreeId !== '' &&
        state.activeTabId != null &&
        state.activeTabId !== ''
          ? { ...state.lastActiveTabByWorktree, [leavingWorktreeId]: state.activeTabId }
          : state.lastActiveTabByWorktree
      // Changing the worktree of a non-current project has no effect on
      // which tab the user is looking at — leave activeTabId alone.
      if (action.projectId !== state.currentProjectId) {
        return { ...state, lastActiveTabByWorktree, projects }
      }
      // For the current project: if the existing activeTabId belongs to
      // the new worktree, keep it. Otherwise restore the last tab we viewed
      // in that worktree, falling back to the first visible tab (or clearing
      // it if the worktree is empty — the pane then renders the "this
      // worktree has no tabs" placeholder).
      const updated = projects.find((s) => s.id === action.projectId)
      const visible = filterTabsForActiveWorktree(state.tabs, updated)
      const currentStillVisible =
        state.activeTabId != null &&
        state.activeTabId !== '' &&
        visible.some((t) => t.id === state.activeTabId)
      if (currentStillVisible) {
        return { ...state, lastActiveTabByWorktree, projects }
      }
      const remembered = lastActiveTabByWorktree[action.worktreeId]
      const nextActiveTabId =
        remembered != null && remembered !== '' && visible.some((t) => t.id === remembered)
          ? remembered
          : (visible[0]?.id ?? null)
      return { ...state, activeTabId: nextActiveTabId, lastActiveTabByWorktree, projects }
    }
    case 'update-worktree-record':
      return {
        ...state,
        projects: state.projects.map((project) =>
          project.id === action.projectId
            ? {
                ...project,
                updatedAt: new Date().toISOString(),
                worktrees: project.worktrees?.map((worktree) =>
                  worktree.id === action.worktreeId
                    ? { ...worktree, ...action.patch, updatedAt: new Date().toISOString() }
                    : worktree
                ),
              }
            : project
        ),
      }
    default:
      return null
  }
}
