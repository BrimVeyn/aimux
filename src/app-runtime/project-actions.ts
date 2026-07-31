import type { SessionBackend } from '../session-backend/types'
import type { AppAction, AppState, ProjectRecord, TabSession } from '../state/types'

import { logInputDebug } from '../debug/input-log'
import { createPrefixedId } from '../platform/id'
import { saveProjectCatalog } from '../state/project-catalog'
import { createEmptyWorkspaceSnapshot, serializeWorkspace } from '../state/project-persistence'
import { createPrimaryWorktree, ensureProjectWorktrees } from '../state/project-worktrees'
import { toast } from '../state/toast-store'
import { buildProjectsWithCurrentSnapshot } from '../state/workspace-save'

export function createProjectFromCurrentState(
  state: AppState,
  name: string,
  projectPath?: string
): { project: ProjectRecord; projects: ProjectRecord[] } {
  const now = new Date().toISOString()
  const workspaceSnapshot =
    (state.currentProjectId != null && state.currentProjectId !== '') || state.tabs.length === 0
      ? createEmptyWorkspaceSnapshot()
      : serializeWorkspace(state)
  const project: ProjectRecord = {
    activeWorktreeId: undefined,
    createdAt: now,
    id: createPrefixedId('project'),
    lastOpenedAt: now,
    name,
    projectPath,
    updatedAt: now,
    workspaceSnapshot,
    worktrees: undefined,
  }
  if (projectPath != null && projectPath !== '') {
    const worktree = createPrimaryWorktree(projectPath, now)
    project.activeWorktreeId = worktree.id
    project.worktrees = [worktree]
  }

  let updatedProjects = state.projects
  if (state.currentProjectId != null && state.currentProjectId !== '') {
    const currentSnapshot = serializeWorkspace(state)
    updatedProjects = state.projects.map((entry) =>
      entry.id === state.currentProjectId
        ? { ...entry, updatedAt: now, workspaceSnapshot: currentSnapshot }
        : entry
    )
  }

  return {
    project,
    projects: [...updatedProjects, ensureProjectWorktrees(project)],
  }
}

export function renameProjectRecords(
  projects: ProjectRecord[],
  projectId: string,
  name: string
): ProjectRecord[] {
  return projects.map((project) =>
    project.id === projectId ? { ...project, name, updatedAt: new Date().toISOString() } : project
  )
}

export function switchProjectRecords(state: AppState, project: ProjectRecord): ProjectRecord[] {
  const projectsWithSnapshot = buildProjectsWithCurrentSnapshot(
    state.projects,
    state.currentProjectId,
    state
  )
  return projectsWithSnapshot.map((entry) =>
    entry.id === project.id ? { ...entry, lastOpenedAt: new Date().toISOString() } : entry
  )
}

export function deleteProjectRecords(
  projects: ProjectRecord[],
  projectId: string
): ProjectRecord[] {
  return projects.filter((project) => project.id !== projectId)
}

export function handleCreateProjectEffect(
  state: AppState,
  dispatch: (action: AppAction) => void,
  name: string,
  projectPath?: string
): void {
  const { project, projects } = createProjectFromCurrentState(state, name, projectPath)
  logInputDebug('app.project.create', {
    fromCurrentWorkspace:
      (state.currentProjectId == null || state.currentProjectId === '') && state.tabs.length > 0,
    name,
    projectId: project.id,
    tabCount: project.workspaceSnapshot?.tabs.length ?? 0,
  })
  saveProjectCatalog(projects)
  dispatch({ projects, type: 'set-projects' })
  dispatch({
    projectId: project.id,
    type: 'load-project',
    workspaceSnapshot: project.workspaceSnapshot,
  })
}

export function handleRenameProjectEffect(
  projects: ProjectRecord[],
  dispatch: (action: AppAction) => void,
  projectId: string,
  name: string
): void {
  logInputDebug('app.project.rename', { name, projectId })
  const renamed = renameProjectRecords(projects, projectId, name)
  saveProjectCatalog(renamed)
  dispatch({ name, projectId, type: 'rename-project-record' })
}

export function handleSwitchProjectEffect(
  state: AppState,
  backend: SessionBackend,
  dispatch: (action: AppAction) => void,
  project: ProjectRecord
): void {
  logInputDebug('app.project.switch.start', {
    currentTabCount: state.tabs.length,
    fromProjectId: state.currentProjectId,
    restoredTabCount: project.workspaceSnapshot?.tabs.length ?? 0,
    toName: project.name,
    toProjectId: project.id,
  })
  const projects = switchProjectRecords(state, project)
  saveProjectCatalog(projects)
  void backend.destroy(true)
  dispatch({ projects, type: 'set-projects' })
  dispatch({
    projectId: project.id,
    type: 'load-project',
    workspaceSnapshot: project.workspaceSnapshot,
  })
  logInputDebug('app.project.switch.dispatched', { toProjectId: project.id })
}

export function handleDeleteProjectEffect(
  state: AppState,
  backend: SessionBackend,
  dispatch: (action: AppAction) => void,
  projectId: string,
  options?: { openProjectPicker?: boolean }
): void {
  const name = state.projects.find((entry) => entry.id === projectId)?.name
  const remaining = deleteProjectRecords(state.projects, projectId)
  logInputDebug('app.project.delete', {
    projectId,
    remainingCount: remaining.length,
    wasCurrent: projectId === state.currentProjectId,
  })
  saveProjectCatalog(remaining)
  if (projectId === state.currentProjectId) {
    void backend.destroy(true)
  }
  dispatch({
    openProjectPicker: options?.openProjectPicker,
    projectId,
    type: 'delete-project-record',
  })
  toast.success(name != null && name !== '' ? `Deleted workspace "${name}"` : 'Workspace deleted')
}

export function restartTabSession(
  backend: SessionBackend,
  dispatch: (action: AppAction) => void,
  clearIdleTimer: (tabId: string) => void,
  clearStartupGrace: (tabId: string) => void,
  startTabSession: (tab: TabSession) => void,
  tab: TabSession
): void {
  logInputDebug('app.restartTab', {
    command: tab.command,
    status: tab.status,
    tabId: tab.id,
  })
  clearIdleTimer(tab.id)
  clearStartupGrace(tab.id)
  backend.disposeSession(tab.id)
  dispatch({ tabId: tab.id, type: 'reset-tab-project' })
  startTabSession(tab)
}
