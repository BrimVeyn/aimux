import type { ProjectRecord, WorkspaceRecord } from '../../../state/types'
import type { DaemonClient } from '../../client/daemon-client'

import { createGitWorktree, removeGitWorktree, resolveGitRef } from '../../../git/worktree'
import { IPC_CAPABILITY_WORKSPACE_LIFECYCLE_EVENTS } from '../../../ipc/protocol'
import { createPrefixedId } from '../../../platform/id'
import {
  assertSafeAimuxWorktreePath,
  ensureAimuxWorktreeRoot,
  makeWorktreePath,
  pruneEmptyWorktreeParent,
} from '../../../platform/worktree-paths'
import { shouldRefreshBase } from '../../../settings/flags'

export interface CreateWorkspaceParams {
  /** Base ref for the branch (callers default to 'HEAD'). */
  base: string
  /** Branch name (callers default to `aimux/<name>`). */
  branch: string
  daemon: DaemonClient
  name: string
  project: ProjectRecord
}

/**
 * Create a git worktree + its catalog record for a project. Shared by
 * `workspace create` and `tab create --new-workspace`. Checks the daemon
 * capability BEFORE touching disk, and rolls back the on-disk workspace if
 * catalog registration fails (so `worktree list` never surfaces an orphan).
 * Throws on any failure; returns the registered record on success.
 */
export async function createProjectWorkspace(
  params: CreateWorkspaceParams
): Promise<WorkspaceRecord> {
  const { base, branch, daemon, name, project } = params

  const primary = project.workspaces?.find((w) => w.source === 'primary')
  if (!primary) {
    throw new Error(
      `project "${project.name}" has no primary workspace — set --project when creating it`
    )
  }

  // Check the daemon's capability BEFORE mutating disk — otherwise a capability
  // mismatch would leave a git worktree on disk with no catalog record.
  if (!daemon.hasCapability(IPC_CAPABILITY_WORKSPACE_LIFECYCLE_EVENTS)) {
    throw new Error(
      'daemon predates workspaceLifecycleEvents capability — restart aimux to pick up the new daemon'
    )
  }

  // Verify the base ref in the REPO WE ARE ABOUT TO USE, before touching disk.
  // The project decides the repo, so a caller who believes it is orchestrating
  // project A while the resolved project points at project B would otherwise
  // get either a confusing bare git error or — when the ref exists in both repos
  // — a silent success in the wrong project.
  if ((await resolveGitRef(primary.repoRoot, base)) === undefined) {
    throw new Error(
      `base ref "${base}" does not exist in ${primary.repoRoot} (project "${project.name}") — check that this is the repository you meant`
    )
  }

  const workspaceId = createPrefixedId('workspace')
  const targetPath = makeWorktreePath({
    repoRoot: primary.repoRoot,
    workspaceId,
    workspaceName: name,
  })
  await ensureAimuxWorktreeRoot()
  await assertSafeAimuxWorktreePath(targetPath)

  let forkRef: string
  try {
    forkRef = await createGitWorktree({
      baseRef: base,
      branchName: branch,
      refreshBase: shouldRefreshBase(),
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
  const record: WorkspaceRecord = {
    // What it forked from: `origin/<base>` when the base was refreshed.
    baseRef: forkRef,
    branch,
    createdAt: now,
    createdByAimux: true,
    id: workspaceId,
    name,
    path: targetPath,
    repoRoot: primary.repoRoot,
    source: 'aimux-temp',
    updatedAt: now,
  }

  try {
    await daemon.expectOk('addWorkspaceRecord', { projectId: project.id, workspace: record })
  } catch (error) {
    // Catalog registration failed — roll back the on-disk workspace so
    // `worktree list` doesn't perpetually surface an orphan. Swallow rollback
    // errors: report the original failure, the real problem to surface.
    try {
      await removeGitWorktree({ force: true, repoPath: primary.repoRoot, targetPath })
      await pruneEmptyWorktreeParent(targetPath)
    } catch {
      // Best-effort rollback; leave the git-side workspace if it can't be removed
      // cleanly. `worktree list` will flag it as gitTracked with no catalog.
    }
    throw error
  }

  return record
}
