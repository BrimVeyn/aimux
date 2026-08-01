import type { ProjectRecord, WorkspaceRecord } from '../state/types'

import { logDebug } from '../debug/input-log'
import { createPrefixedId } from '../platform/id'
import { loadProjectCatalog, saveProjectCatalog } from '../state/project-catalog'
import { createEmptyProjectSnapshot } from '../state/project-persistence'
import { createPrimaryWorkspace, ensureProjectWorkspaces } from '../state/project-workspaces'

/**
 * Catalog mutations invoked by the daemon when NO UI is attached. When a UI
 * is attached the daemon relays the request as an event and the UI's reducer
 * owns the write (so the live project snapshot is preserved).
 *
 * Each helper is a pure read-modify-write against `aimux-sessions.json` —
 * safe to call from the daemon process, no React / dispatcher involved.
 */

export function createProjectInCatalog(name: string, projectPath?: string): ProjectRecord {
  const projects = loadProjectCatalog()
  const now = new Date().toISOString()
  const project: ProjectRecord = {
    activeWorkspaceId: undefined,
    createdAt: now,
    id: createPrefixedId('project'),
    lastOpenedAt: now,
    name,
    projectPath,
    projectSnapshot: createEmptyProjectSnapshot(),
    updatedAt: now,
    workspaces: undefined,
  }
  if (projectPath != null && projectPath !== '') {
    const workspace = createPrimaryWorkspace(projectPath, now)
    project.activeWorkspaceId = workspace.id
    project.workspaces = [workspace]
  }
  saveProjectCatalog([...projects, ensureProjectWorkspaces(project)])
  logDebug('daemon.catalog.createProject', { name, projectId: project.id, projectPath })
  return project
}

/**
 * Throws when the target project isn't in the catalog. Used by the daemon
 * before broadcasting a project-lifecycle request so the CLI's `expectOk`
 * fails fast (with a meaningful message) instead of the `--wait` path
 * hanging out for its timeout while the UI silently ignores an unknown id.
 */
export function assertProjectInCatalog(projectId: string): void {
  const projects = loadProjectCatalog()
  if (!projects.some((s) => s.id === projectId)) {
    throw new Error(`project not found: ${projectId}`)
  }
}

export function bumpLastOpenedInCatalog(projectId: string): void {
  const projects = loadProjectCatalog()
  const now = new Date().toISOString()
  const target = projects.find((s) => s.id === projectId)
  if (!target) {
    throw new Error(`project not found: ${projectId}`)
  }
  const updated = projects.map((s) => (s.id === projectId ? { ...s, lastOpenedAt: now } : s))
  saveProjectCatalog(updated)
  logDebug('daemon.catalog.switchProject', { projectId })
}

export function deleteFromCatalog(projectId: string): void {
  const projects = loadProjectCatalog()
  const remaining = projects.filter((s) => s.id !== projectId)
  if (remaining.length === projects.length) {
    throw new Error(`project not found: ${projectId}`)
  }
  saveProjectCatalog(remaining)
  logDebug('daemon.catalog.closeProject', { projectId })
}

export function addWorkspaceToCatalog(projectId: string, workspace: WorkspaceRecord): void {
  const projects = loadProjectCatalog()
  const target = projects.find((s) => s.id === projectId)
  if (!target) {
    throw new Error(`project not found: ${projectId}`)
  }
  const existing = target.workspaces ?? []
  if (existing.some((w) => w.id === workspace.id)) {
    throw new Error(`workspace already exists: ${workspace.id}`)
  }
  const updated = projects.map((s) =>
    s.id === projectId
      ? { ...s, updatedAt: new Date().toISOString(), workspaces: [...existing, workspace] }
      : s
  )
  saveProjectCatalog(updated)
  logDebug('daemon.catalog.addWorkspace', {
    projectId,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
  })
}

export function removeWorkspaceFromCatalog(projectId: string, workspaceId: string): void {
  const projects = loadProjectCatalog()
  const target = projects.find((s) => s.id === projectId)
  if (!target) {
    throw new Error(`project not found: ${projectId}`)
  }
  const existing = target.workspaces ?? []
  const nextWorkspaces = existing.filter((w) => w.id !== workspaceId)
  if (nextWorkspaces.length === existing.length) {
    throw new Error(`workspace not found: ${workspaceId}`)
  }
  const updated = projects.map((s) =>
    s.id === projectId
      ? {
          ...s,
          activeWorkspaceId: s.activeWorkspaceId === workspaceId ? undefined : s.activeWorkspaceId,
          updatedAt: new Date().toISOString(),
          workspaces: nextWorkspaces,
        }
      : s
  )
  saveProjectCatalog(updated)
  logDebug('daemon.catalog.removeWorkspace', { projectId, workspaceId })
}
