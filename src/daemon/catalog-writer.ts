import type { SessionRecord, WorktreeRecord } from '../state/types'

import { logDebug } from '../debug/input-log'
import { createPrefixedId } from '../platform/id'
import { loadSessionCatalog, saveSessionCatalog } from '../state/session-catalog'
import { createEmptyWorkspaceSnapshot } from '../state/session-persistence'
import { createPrimaryWorktree, ensureSessionWorktrees } from '../state/session-worktrees'

/**
 * Catalog mutations invoked by the daemon when NO UI is attached. When a UI
 * is attached the daemon relays the request as an event and the UI's reducer
 * owns the write (so the live workspace snapshot is preserved).
 *
 * Each helper is a pure read-modify-write against `aimux-sessions.json` —
 * safe to call from the daemon process, no React / dispatcher involved.
 */

export function createWorkspaceInCatalog(name: string, projectPath?: string): SessionRecord {
  const sessions = loadSessionCatalog()
  const now = new Date().toISOString()
  const session: SessionRecord = {
    activeWorktreeId: undefined,
    createdAt: now,
    id: createPrefixedId('session'),
    lastOpenedAt: now,
    name,
    projectPath,
    updatedAt: now,
    workspaceSnapshot: createEmptyWorkspaceSnapshot(),
    worktrees: undefined,
  }
  if (projectPath != null && projectPath !== '') {
    const worktree = createPrimaryWorktree(projectPath, now)
    session.activeWorktreeId = worktree.id
    session.worktrees = [worktree]
  }
  saveSessionCatalog([...sessions, ensureSessionWorktrees(session)])
  logDebug('daemon.catalog.createWorkspace', { name, projectPath, sessionId: session.id })
  return session
}

/**
 * Throws when the target session isn't in the catalog. Used by the daemon
 * before broadcasting a workspace-lifecycle request so the CLI's `expectOk`
 * fails fast (with a meaningful message) instead of the `--wait` path
 * hanging out for its timeout while the UI silently ignores an unknown id.
 */
export function assertSessionInCatalog(sessionId: string): void {
  const sessions = loadSessionCatalog()
  if (!sessions.some((s) => s.id === sessionId)) {
    throw new Error(`workspace not found: ${sessionId}`)
  }
}

export function bumpLastOpenedInCatalog(sessionId: string): void {
  const sessions = loadSessionCatalog()
  const now = new Date().toISOString()
  const target = sessions.find((s) => s.id === sessionId)
  if (!target) {
    throw new Error(`workspace not found: ${sessionId}`)
  }
  const updated = sessions.map((s) => (s.id === sessionId ? { ...s, lastOpenedAt: now } : s))
  saveSessionCatalog(updated)
  logDebug('daemon.catalog.switchWorkspace', { sessionId })
}

export function deleteFromCatalog(sessionId: string): void {
  const sessions = loadSessionCatalog()
  const remaining = sessions.filter((s) => s.id !== sessionId)
  if (remaining.length === sessions.length) {
    throw new Error(`workspace not found: ${sessionId}`)
  }
  saveSessionCatalog(remaining)
  logDebug('daemon.catalog.closeWorkspace', { sessionId })
}

export function addWorktreeToCatalog(sessionId: string, worktree: WorktreeRecord): void {
  const sessions = loadSessionCatalog()
  const target = sessions.find((s) => s.id === sessionId)
  if (!target) {
    throw new Error(`workspace not found: ${sessionId}`)
  }
  const existing = target.worktrees ?? []
  if (existing.some((w) => w.id === worktree.id)) {
    throw new Error(`worktree already exists: ${worktree.id}`)
  }
  const updated = sessions.map((s) =>
    s.id === sessionId
      ? { ...s, updatedAt: new Date().toISOString(), worktrees: [...existing, worktree] }
      : s
  )
  saveSessionCatalog(updated)
  logDebug('daemon.catalog.addWorktree', {
    sessionId,
    worktreeId: worktree.id,
    worktreeName: worktree.name,
  })
}

export function removeWorktreeFromCatalog(sessionId: string, worktreeId: string): void {
  const sessions = loadSessionCatalog()
  const target = sessions.find((s) => s.id === sessionId)
  if (!target) {
    throw new Error(`workspace not found: ${sessionId}`)
  }
  const existing = target.worktrees ?? []
  const nextWorktrees = existing.filter((w) => w.id !== worktreeId)
  if (nextWorktrees.length === existing.length) {
    throw new Error(`worktree not found: ${worktreeId}`)
  }
  const updated = sessions.map((s) =>
    s.id === sessionId
      ? {
          ...s,
          activeWorktreeId: s.activeWorktreeId === worktreeId ? undefined : s.activeWorktreeId,
          updatedAt: new Date().toISOString(),
          worktrees: nextWorktrees,
        }
      : s
  )
  saveSessionCatalog(updated)
  logDebug('daemon.catalog.removeWorktree', { sessionId, worktreeId })
}
