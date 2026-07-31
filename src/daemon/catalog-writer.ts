import type { ProjectRecord, WorktreeRecord } from '../state/types'

import { logDebug } from '../debug/input-log'
import { createPrefixedId } from '../platform/id'
import { loadProjectCatalog, saveProjectCatalog } from '../state/project-catalog'
import { createEmptyWorkspaceSnapshot } from '../state/project-persistence'
import { createPrimaryWorktree, ensureProjectWorktrees } from '../state/project-worktrees'

/**
 * Catalog mutations invoked by the daemon when NO UI is attached. When a UI
 * is attached the daemon relays the request as an event and the UI's reducer
 * owns the write (so the live workspace snapshot is preserved).
 *
 * Each helper is a pure read-modify-write against `aimux-sessions.json` —
 * safe to call from the daemon process, no React / dispatcher involved.
 */

export function createWorkspaceInCatalog(name: string, projectPath?: string): ProjectRecord {
  const projects = loadProjectCatalog()
  const now = new Date().toISOString()
  const project: ProjectRecord = {
    activeWorktreeId: undefined,
    createdAt: now,
    id: createPrefixedId('project'),
    lastOpenedAt: now,
    name,
    projectPath,
    updatedAt: now,
    workspaceSnapshot: createEmptyWorkspaceSnapshot(),
    worktrees: undefined,
  }
  if (projectPath != null && projectPath !== '') {
    const worktree = createPrimaryWorktree(projectPath, now)
    project.activeWorktreeId = worktree.id
    project.worktrees = [worktree]
  }
  saveProjectCatalog([...projects, ensureProjectWorktrees(project)])
  logDebug('daemon.catalog.createWorkspace', { name, projectId: project.id, projectPath })
  return project
}

/**
 * Throws when the target project isn't in the catalog. Used by the daemon
 * before broadcasting a workspace-lifecycle request so the CLI's `expectOk`
 * fails fast (with a meaningful message) instead of the `--wait` path
 * hanging out for its timeout while the UI silently ignores an unknown id.
 */
export function assertProjectInCatalog(projectId: string): void {
  const projects = loadProjectCatalog()
  if (!projects.some((s) => s.id === projectId)) {
    throw new Error(`workspace not found: ${projectId}`)
  }
}

export function bumpLastOpenedInCatalog(projectId: string): void {
  const projects = loadProjectCatalog()
  const now = new Date().toISOString()
  const target = projects.find((s) => s.id === projectId)
  if (!target) {
    throw new Error(`workspace not found: ${projectId}`)
  }
  const updated = projects.map((s) => (s.id === projectId ? { ...s, lastOpenedAt: now } : s))
  saveProjectCatalog(updated)
  logDebug('daemon.catalog.switchWorkspace', { projectId })
}

export function deleteFromCatalog(projectId: string): void {
  const projects = loadProjectCatalog()
  const remaining = projects.filter((s) => s.id !== projectId)
  if (remaining.length === projects.length) {
    throw new Error(`workspace not found: ${projectId}`)
  }
  saveProjectCatalog(remaining)
  logDebug('daemon.catalog.closeWorkspace', { projectId })
}

export function addWorktreeToCatalog(projectId: string, worktree: WorktreeRecord): void {
  const projects = loadProjectCatalog()
  const target = projects.find((s) => s.id === projectId)
  if (!target) {
    throw new Error(`workspace not found: ${projectId}`)
  }
  const existing = target.worktrees ?? []
  if (existing.some((w) => w.id === worktree.id)) {
    throw new Error(`worktree already exists: ${worktree.id}`)
  }
  const updated = projects.map((s) =>
    s.id === projectId
      ? { ...s, updatedAt: new Date().toISOString(), worktrees: [...existing, worktree] }
      : s
  )
  saveProjectCatalog(updated)
  logDebug('daemon.catalog.addWorktree', {
    projectId,
    worktreeId: worktree.id,
    worktreeName: worktree.name,
  })
}

export function removeWorktreeFromCatalog(projectId: string, worktreeId: string): void {
  const projects = loadProjectCatalog()
  const target = projects.find((s) => s.id === projectId)
  if (!target) {
    throw new Error(`workspace not found: ${projectId}`)
  }
  const existing = target.worktrees ?? []
  const nextWorktrees = existing.filter((w) => w.id !== worktreeId)
  if (nextWorktrees.length === existing.length) {
    throw new Error(`worktree not found: ${worktreeId}`)
  }
  const updated = projects.map((s) =>
    s.id === projectId
      ? {
          ...s,
          activeWorktreeId: s.activeWorktreeId === worktreeId ? undefined : s.activeWorktreeId,
          updatedAt: new Date().toISOString(),
          worktrees: nextWorktrees,
        }
      : s
  )
  saveProjectCatalog(updated)
  logDebug('daemon.catalog.removeWorktree', { projectId, worktreeId })
}
