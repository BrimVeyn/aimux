import type { SessionRecord, WorktreeRecord } from '../../../state/types'
import type { DaemonClient } from '../../client/daemon-client'

import { createGitWorktree, removeGitWorktree, resolveGitRef } from '../../../git/worktree'
import { IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS } from '../../../ipc/protocol'
import { createPrefixedId } from '../../../platform/id'
import {
  assertSafeAimuxWorktreePath,
  ensureAimuxWorktreeRoot,
  makeWorktreePath,
  pruneEmptyWorktreeParent,
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

  // Verify the base ref in the REPO WE ARE ABOUT TO USE, before touching disk.
  // The workspace decides the repo, so a caller who believes it is orchestrating
  // project A while the resolved workspace points at project B would otherwise
  // get either a confusing bare git error or — when the ref exists in both repos
  // — a silent success in the wrong project.
  if ((await resolveGitRef(primary.repoRoot, base)) === undefined) {
    throw new Error(
      `base ref "${base}" does not exist in ${primary.repoRoot} (workspace "${workspace.name}") — check that this is the repository you meant`
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

  try {
    await createGitWorktree({
      baseRef: base,
      branchName: branch,
      repoPath: primary.repoRoot,
      targetPath,
    })
  } catch (error) {
    // `assertSafeAimuxWorktreePath` had to mkdir the repo-scoped parent for git;
    // a failed creation must not leave that directory behind.
    await pruneEmptyWorktreeParent(targetPath)
    throw error
  }

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
      await pruneEmptyWorktreeParent(targetPath)
    } catch {
      // Best-effort rollback; leave the git-side worktree if it can't be removed
      // cleanly. `worktree list` will flag it as gitTracked with no catalog.
    }
    throw error
  }

  return record
}
