import type { SessionRecord, WorktreeRecord } from '../../../state/types'
import type { DaemonClient } from '../../client/daemon-client'

import { createGitWorktree, removeGitWorktree } from '../../../git/worktree'
import { IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS } from '../../../ipc/protocol'
import { createPrefixedId } from '../../../platform/id'
import {
  assertSafeAimuxWorktreePath,
  ensureAimuxWorktreeRoot,
  makeWorktreePath,
} from '../../../platform/worktree-paths'

export interface CreateWorktreeParams {
  /** Base ref for the branch (callers default to 'HEAD'). */
  base: string
  /** Branch name (callers default to `aimux/<name>`). */
  branch: string
  daemon: DaemonClient
  name: string
  workspace: SessionRecord
}

/**
 * Create a git worktree + its catalog record for a workspace. Shared by
 * `worktree create` and `tab create --new-worktree`. Checks the daemon
 * capability BEFORE touching disk, and rolls back the on-disk worktree if
 * catalog registration fails (so `worktree list` never surfaces an orphan).
 * Throws on any failure; returns the registered record on success.
 */
export async function createWorkspaceWorktree(
  params: CreateWorktreeParams
): Promise<WorktreeRecord> {
  const { base, branch, daemon, name, workspace } = params

  const primary = workspace.worktrees?.find((w) => w.source === 'primary')
  if (!primary) {
    throw new Error(
      `workspace "${workspace.name}" has no primary worktree — set --project when creating it`
    )
  }

  // Check the daemon's capability BEFORE mutating disk — otherwise a capability
  // mismatch would leave a git worktree on disk with no catalog record.
  if (!daemon.hasCapability(IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS)) {
    throw new Error(
      'daemon predates worktreeLifecycleEvents capability — restart aimux to pick up the new daemon'
    )
  }

  const worktreeId = createPrefixedId('worktree')
  const targetPath = makeWorktreePath({
    repoRoot: primary.repoRoot,
    worktreeId,
    worktreeName: name,
  })
  await ensureAimuxWorktreeRoot()
  await assertSafeAimuxWorktreePath(targetPath)

  await createGitWorktree({
    baseRef: base,
    branchName: branch,
    repoPath: primary.repoRoot,
    targetPath,
  })

  const now = new Date().toISOString()
  const record: WorktreeRecord = {
    baseRef: base,
    branch,
    createdAt: now,
    createdByAimux: true,
    id: worktreeId,
    name,
    path: targetPath,
    repoRoot: primary.repoRoot,
    source: 'aimux-temp',
    updatedAt: now,
  }

  try {
    await daemon.expectOk('addWorktreeRecord', { sessionId: workspace.id, worktree: record })
  } catch (error) {
    // Catalog registration failed — roll back the on-disk worktree so
    // `worktree list` doesn't perpetually surface an orphan. Swallow rollback
    // errors: report the original failure, the real problem to surface.
    try {
      await removeGitWorktree({ force: true, repoPath: primary.repoRoot, targetPath })
    } catch {
      // Best-effort rollback; leave the git-side worktree if it can't be removed
      // cleanly. `worktree list` will flag it as gitTracked with no catalog.
    }
    throw error
  }

  return record
}
