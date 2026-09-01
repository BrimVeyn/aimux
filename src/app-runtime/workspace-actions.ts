import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { AppState, WorkspaceRecord } from '../state/types'
import type { SideEffectContext } from './side-effect-context'

import { moveWorkspace } from '../git/move-workspace'
import {
  createGitWorktree,
  deleteGitBranch,
  getCurrentBranch,
  getHeadSha,
  getMainWorktreeRoot,
  listGitWorktrees,
  pruneGitWorktrees,
  removeGitWorktree,
} from '../git/worktree'
import { copyWorktreeFiles } from '../git/worktree-files'
import { createPrefixedId } from '../platform/id'
import {
  assertSafeAimuxWorktreePath,
  isInsideAimuxWorktreeRoot,
  makeWorktreePath,
  sanitizePathSegment,
} from '../platform/worktree-paths'
import { shouldRefreshBase, worktreeCopyPatterns } from '../settings/flags'
import { saveProjectCatalog } from '../state/project-catalog'
import { pruneSnapshotOfWorkspace } from '../state/project-persistence'
import { getActiveWorkspace, getActiveWorkspacePath } from '../state/project-workspaces'
import { toast } from '../state/toast-store'

/**
 * Rewrite one project and hand back the whole list, ready for `set-projects`.
 *
 * Reads the *live* store rather than `ctx.state`: callers reach here after
 * seconds of git work, and `ctx.state` is the render snapshot from before it.
 * Since `set-projects` replaces the array wholesale, a stale read does not just
 * miss an update — it reverts it. Workspace naming lands asynchronously, so
 * that window is wide open.
 */
export function replaceProject(
  ctx: SideEffectContext,
  projectId: string,
  next: (project: AppState['projects'][number]) => AppState['projects'][number]
): AppState['projects'] {
  return ctx
    .getState()
    .projects.map((project) => (project.id === projectId ? next(project) : project))
}

export function handleSwitchWorkspace(
  ctx: SideEffectContext,
  projectId: string,
  workspaceId: string
): void {
  const project = ctx.state.projects.find((entry) => entry.id === projectId)
  const workspace = project?.workspaces?.find((entry) => entry.id === workspaceId)
  if (!project || !workspace) return
  const projects = replaceProject(ctx, projectId, (entry) => ({
    ...entry,
    activeWorkspaceId: workspaceId,
    updatedAt: new Date().toISOString(),
  }))
  saveProjectCatalog(projects)
  ctx.dispatch({ projects, type: 'set-projects' })
}

/**
 * Set (or clear, when blank) the branch this project's new workspaces fork from.
 * Here rather than with the project actions: the value is workspace policy that
 * happens to be stored on the project, and this is where the record-update
 * helper and the rest of that policy already live.
 */
export function setProjectDefaultBaseRef(
  ctx: SideEffectContext,
  projectId: string,
  baseRef: string
): void {
  const trimmed = baseRef.trim()
  const projects = replaceProject(ctx, projectId, (entry) => ({
    ...entry,
    defaultBaseRef: trimmed === '' ? undefined : trimmed,
    updatedAt: new Date().toISOString(),
  }))
  saveProjectCatalog(projects)
  ctx.dispatch({ projects, type: 'set-projects' })
}

/** Fold or unfold a project's workspace rows in the sidebar. */
export function toggleProjectCollapsed(ctx: SideEffectContext, projectId: string): void {
  const projects = replaceProject(ctx, projectId, (entry) => ({
    ...entry,
    collapsed: entry.collapsed !== true ? true : undefined,
    updatedAt: new Date().toISOString(),
  }))
  saveProjectCatalog(projects)
  ctx.dispatch({ projects, type: 'set-projects' })
}

function normalizeBranchName(branch: string | undefined): string | undefined {
  return branch?.replace(/^refs\/heads\//, '').trim()
}

export async function createAimuxTempWorkspace(
  ctx: SideEffectContext,
  projectId: string,
  options: {
    name?: string
    branchName?: string
    baseRef?: string
    sourceWorkspaceId?: string
    /**
     * Pre-allocated by callers that must name the workspace before git is done
     * cutting it — the `<C-p>` chain pins a tab to it while it is still being
     * created.
     */
    workspaceId?: string
  } = {}
): Promise<WorkspaceRecord | undefined> {
  const {
    baseRef: requestedBaseRef,
    branchName: requestedBranchName,
    name: requestedName,
  } = options
  const project = ctx.state.projects.find((entry) => entry.id === projectId)
  const source =
    project?.workspaces?.find((entry) => entry.id === options.sourceWorkspaceId) ??
    getActiveWorkspace(project)
  const sourcePath = source?.path ?? getActiveWorkspacePath(project)
  if (!project || !(sourcePath != null && sourcePath !== '')) return undefined

  // Resolve the *main* repo checkout, never the active linked workspace, so the
  // record's repoRoot stays valid after sibling workspaces are deleted.
  const repoRoot = (await getMainWorktreeRoot(sourcePath)) ?? source?.repoRoot ?? sourcePath
  const baseBranch = (await getCurrentBranch(sourcePath)) ?? source?.branch ?? 'HEAD'
  const baseRef = requestedBaseRef ?? baseBranch
  const workspaceId = options.workspaceId ?? createPrefixedId('workspace')
  const trimmedName = requestedName?.trim()
  const workspaceName =
    trimmedName != null && trimmedName !== ''
      ? trimmedName
      : `wt-${sanitizePathSegment(project.name, 12)}`
  const trimmedBranch = requestedBranchName?.trim()
  const branchName =
    trimmedBranch != null && trimmedBranch !== ''
      ? trimmedBranch
      : // Placeholder only: the model replaces it with a conventional
        // `<type>/<subject>` branch seconds later. Kept in the `aimux/`
        // namespace and lowercased so what survives a failed generation still
        // reads as a throwaway branch rather than a shouted prompt.
        `aimux/${sanitizePathSegment(workspaceName, 40).toLowerCase()}-${Date.now().toString(36)}`
  const targetPath = makeWorktreePath({ repoRoot, workspaceId, workspaceName })

  const existingWorkspace = (await listGitWorktrees(repoRoot)).find(
    (entry) =>
      entry.prunable !== true &&
      normalizeBranchName(entry.branch) === normalizeBranchName(branchName)
  )
  if (existingWorkspace) {
    ctx.dispatch({
      message: `Branch already checked out in another workspace: ${existingWorkspace.path}`,
      type: 'set-create-workspace-branch-error',
    })
    return undefined
  }

  await mkdir(dirname(targetPath), { recursive: true })
  await assertSafeAimuxWorktreePath(targetPath)
  // What it forked from, not what was asked for: the two differ whenever the
  // base was refreshed from origin, and the record is what "based on" reads.
  const forkRef = await createGitWorktree({
    baseRef,
    branchName,
    refreshBase: shouldRefreshBase(),
    repoPath: repoRoot,
    targetPath,
  })
  await copyWorktreeFiles(repoRoot, targetPath, worktreeCopyPatterns())
  const now = new Date().toISOString()

  const workspace: WorkspaceRecord = {
    baseRef: forkRef,
    branch: branchName,
    commitSha: await getHeadSha(targetPath),
    createdAt: now,
    createdByAimux: true,
    id: workspaceId,
    name: workspaceName,
    path: targetPath,
    repoRoot,
    source: 'aimux-temp',
    updatedAt: now,
  }
  const projects = replaceProject(ctx, projectId, (entry) => ({
    ...entry,
    activeWorkspaceId: workspace.id,
    updatedAt: now,
    workspaces: [...(entry.workspaces ?? []), workspace],
  }))
  saveProjectCatalog(projects)
  ctx.dispatch({ projects, type: 'set-projects' })
  toast.success(`Created workspace ${branchName}`)
  return workspace
}

// Dispose and close every tab pinned to a workspace (timers, pty project, state).
function disposeWorkspaceTabs(ctx: SideEffectContext, workspaceId: string): void {
  for (const tab of ctx.state.tabs.filter((entry) => entry.workspaceId === workspaceId)) {
    ctx.clearIdleTimer(tab.id)
    ctx.clearStartupGrace(tab.id)
    ctx.backend.disposeSession(tab.id)
    ctx.dispatch({ tabId: tab.id, type: 'close-tab' })
  }
}

/**
 * Put every idle assistant tab in a workspace to sleep: kill the PTY, keep the
 * frozen screen, resume on focus. The RAM a workspace holds is its assistant
 * processes — several hundred MB each — and none of it is aimux's own.
 *
 * A tab mid-turn is never touched. The lot is deliberately partial rather than
 * all-or-nothing: one busy tab should not veto the other three, and the toast
 * says what stayed up so the skip is never silent.
 *
 * ponytail: `activity` comes from reading the assistant's screen, so it sees a
 * turn in progress but not a background task the assistant spawned. Manual-only
 * for exactly that reason — you know what you left running; a timer would not.
 */
export function hibernateWorkspace(ctx: SideEffectContext, workspaceId: string): void {
  const tabs = ctx.state.tabs.filter(
    (tab) => tab.workspaceId === workspaceId && tab.role !== 'setup'
  )
  const sleepable = tabs.filter(
    (tab) => (tab.status === 'running' || tab.status === 'starting') && tab.activity === 'idle'
  )
  const busy = tabs.filter(
    (tab) => (tab.status === 'running' || tab.status === 'starting') && tab.activity !== 'idle'
  )

  for (const tab of sleepable) {
    ctx.clearIdleTimer(tab.id)
    ctx.clearStartupGrace(tab.id)
    ctx.backend.disposeSession(tab.id)
    ctx.dispatch({ tabId: tab.id, type: 'hibernate-tab' })
  }

  if (sleepable.length === 0) {
    toast.info(
      busy.length > 0 ? `Nothing to hibernate — ${busy.length} tab(s) busy` : 'Nothing to hibernate'
    )
    return
  }
  toast.success(
    busy.length > 0
      ? `Hibernated ${sleepable.length} tab(s), skipped ${busy.length} busy`
      : `Hibernated ${sleepable.length} tab(s)`
  )
}

export async function runDeleteWorkspace(
  ctx: SideEffectContext,
  projectId: string,
  workspaceId: string,
  force: boolean,
  closeTabs = false
): Promise<void> {
  const project = ctx.state.projects.find((entry) => entry.id === projectId)
  const workspace = project?.workspaces?.find((entry) => entry.id === workspaceId)
  if (!project) throw new Error('project not found')
  if (!workspace) throw new Error('workspace not found')
  if ((project.workspaces?.length ?? 0) <= 1) throw new Error('at least one workspace must remain')
  if (workspace.source === 'primary') throw new Error('root workspace cannot be deleted')

  const tabsInWorkspace = ctx.state.tabs.filter((tab) => tab.workspaceId === workspaceId)
  // The active-tabs guard asks the modal user to confirm before closing tabs.
  // `closeTabs` (the sidebar's "Remove workspace") opts into closing them
  // directly without forcing the git removal, so dirty temp workspaces are still
  // protected by the non-force `git worktree remove`.
  if (tabsInWorkspace.length > 0 && !force && !closeTabs) {
    throw new ActiveWorkspaceTabsError(tabsInWorkspace.length)
  }

  const repoPath = resolveWorkspaceGitDir(project, workspace)
  const isAimuxTemp = workspace.source === 'aimux-temp' && workspace.createdByAimux
  // Drop the throwaway branch alongside the workspace so deleted temp
  // workspaces don't accumulate in the repo. Scoped by the record rather than by
  // a name prefix: auto-naming renames the branch to a conventional
  // `<type>/<subject>`, indistinguishable from a hand-made one, and
  // `aimux-temp` + `createdByAimux` is exactly "aimux created this branch".
  // Best-effort; git refuses while another worktree still has it checked out.
  const cleanupAimuxBranch = async (): Promise<void> => {
    const branch = workspace.branch
    if (isAimuxTemp && branch != null && branch !== '') {
      await deleteGitBranch(repoPath, branch)
    }
  }

  // Run git ops FIRST. If any throws (dirty workspace, etc.) the catch in the
  // delete-workspace side effect handler re-prompts force or toasts the error —
  // tabs stay open and the row stays in the sidebar, so the UI matches reality
  // instead of leaving tabs closed against a workspace that still exists.
  if (isAimuxTemp && isInsideAimuxWorktreeRoot(workspace.path) && !existsSync(workspace.path)) {
    // The dir vanished but git may still pin the branch to a stale workspace entry.
    await pruneGitWorktrees(repoPath)
  } else if (isAimuxTemp && isInsideAimuxWorktreeRoot(workspace.path)) {
    await assertSafeAimuxWorktreePath(workspace.path)
    await removeGitWorktree({ force, repoPath, targetPath: workspace.path })
  } else if (workspace.source === 'aimux-temp' || workspace.createdByAimux) {
    throw new Error(`refusing unsafe workspace delete: ${workspace.path}`)
  }

  await cleanupAimuxBranch()

  // Only after git success: close tabs + retire the record. Re-read state so
  // we don't operate on the snapshot captured before the awaits above.
  disposeWorkspaceTabs({ ...ctx, state: ctx.getState() }, workspaceId)
  const latest = ctx.getState()
  const latestProject = latest.projects.find((entry) => entry.id === projectId)
  if (latestProject) {
    removeWorkspaceRecordFromProject(
      { ...ctx, state: latest },
      projectId,
      latestProject,
      workspaceId
    )
  }
}

// A workspace's stored repoRoot can point at a sibling workspace that was since
// deleted. Git commands only need *some* existing workspace of the repo (they
// share the common git dir), so fall back to the main checkout or any live
// workspace path rather than letting `git -C` fail on a vanished directory.
function resolveWorkspaceGitDir(
  project: NonNullable<SideEffectContext['state']['projects'][number]>,
  workspace: WorkspaceRecord
): string {
  const candidates = [
    project.workspaces?.find((entry) => entry.source === 'primary')?.path,
    workspace.repoRoot,
    ...(project.workspaces ?? [])
      .filter((entry) => entry.id !== workspace.id)
      .map((entry) => entry.path),
  ]
  return candidates.find((path) => path !== undefined && existsSync(path)) ?? workspace.repoRoot
}

export async function runMoveWorkspace(
  ctx: SideEffectContext,
  projectId: string,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  deleteSource: boolean,
  stashTarget: boolean,
  keepConflicts: boolean
): Promise<void> {
  const project = ctx.state.projects.find((entry) => entry.id === projectId)
  const source = project?.workspaces?.find((entry) => entry.id === sourceWorkspaceId)
  const target = project?.workspaces?.find((entry) => entry.id === targetWorkspaceId)
  if (!project) throw new Error('project not found')
  if (!source || !target) throw new Error('workspace not found')
  if (source.id === target.id) throw new Error('source and target are the same workspace')
  if (source.branch == null || source.branch === '') {
    throw new Error('source workspace has no branch to move')
  }
  if (deleteSource && source.source === 'primary') {
    throw new Error('the primary workspace cannot be deleted')
  }

  const sourceLabel = source.branch ?? source.name
  const targetLabel = target.branch ?? target.name
  const result = await moveWorkspace({
    keepConflicts,
    sourceBranch: source.branch,
    sourcePath: source.path,
    stashTarget,
    targetPath: target.path,
  })

  // Recoverable failures open a confirm dialog carrying retry params; both
  // workspaces are already back in their original state, so confirming simply
  // re-dispatches move-workspace with the matching flag.
  if (result.kind === 'needs-stash' || result.kind === 'conflict') {
    ctx.dispatch({
      deleteSource,
      files: result.files,
      projectId,
      sourceLabel,
      sourceWorkspaceId,
      targetLabel,
      targetWorkspaceId,
      type: 'open-workspace-move-confirm',
      variant: result.kind === 'needs-stash' ? 'stash-target' : 'keep-conflicts',
    })
    return
  }
  if (result.kind === 'conflict-kept') {
    // Never delete the source here — its work only landed half-resolved. The
    // auto-commit driver is safe against this state: git refuses to commit
    // with unmerged index entries, so it fails loudly instead of committing
    // conflict markers.
    handleSwitchWorkspace({ ...ctx, state: ctx.getState() }, projectId, targetWorkspaceId)
    toast.warning(
      `Left conflict markers in ${targetLabel} (${result.files.length} file(s)) — resolve & commit there; ${sourceLabel} kept`
    )
    return
  }
  if (result.kind === 'error') {
    toast.error(`Move failed: ${result.message}`)
    return
  }

  // Land on the target. When deleting the source, close its terminals and
  // switch to the target up front, synchronously, BEFORE the slow
  // `git worktree remove`. Closing the source's active tab re-syncs the active
  // workspace to a default tab (withActiveTabWorkspace); doing the close+switch in
  // one batch lands on the target with no intermediate render, so the removal
  // runs with the target already active instead of flashing/sticking to a
  // default workspace. Re-read state each step so we never resurrect the source.
  if (deleteSource) {
    disposeWorkspaceTabs({ ...ctx, state: ctx.getState() }, sourceWorkspaceId)
    handleSwitchWorkspace({ ...ctx, state: ctx.getState() }, projectId, targetWorkspaceId)
    await runDeleteWorkspace({ ...ctx, state: ctx.getState() }, projectId, sourceWorkspaceId, true)
  } else {
    handleSwitchWorkspace({ ...ctx, state: ctx.getState() }, projectId, targetWorkspaceId)
  }
  const stashNote = result.stashedTarget
    ? ` · target's previous changes stashed (recover with git stash pop)`
    : ''
  toast.success(
    `Moved ${sourceLabel} → ${targetLabel} · ${result.filesChanged} file(s) staged — review & commit${stashNote}`
  )
}

export function removeWorkspaceRecordFromProject(
  ctx: SideEffectContext,
  projectId: string,
  project: NonNullable<SideEffectContext['state']['projects'][number]>,
  workspaceId: string
): void {
  const projects = replaceProject(ctx, projectId, (entry) => {
    // Filtered from `entry`, not from the `project` this was called with: a
    // workspace created while the delete's git work ran is in one and not the
    // other, and rebuilding from the stale copy would delete it too.
    const remaining = (entry.workspaces ?? []).filter((w) => w.id !== workspaceId)
    return {
      ...entry,
      activeWorkspaceId: (entry.activeWorkspaceId === workspaceId
        ? remaining[0]
        : getActiveWorkspace(entry)
      )?.id,
      projectSnapshot: pruneSnapshotOfWorkspace(entry.projectSnapshot, workspaceId),
      updatedAt: new Date().toISOString(),
      workspaces: remaining,
    }
  })
  saveProjectCatalog(projects)
  ctx.dispatch({ projects, type: 'set-projects' })
}

export function isForceableWorkspaceDeleteError(message: string): boolean {
  // `force delete` is the marker `removeGitWorktree` appends to every refusal
  // git raises: matching git's own wording never worked, since a broken worktree
  // link fatals differently ("is not a working tree", "validation failed", …)
  // depending on which part of the link broke.
  return /active assistant tabs|dirty|uncommitted|modified|untracked|not clean|contains.*changes|force delete/i.test(
    message
  )
}

class ActiveWorkspaceTabsError extends Error {
  constructor(tabCount: number) {
    super(
      `active assistant tabs are using this workspace (${tabCount}) — they will be closed if you confirm.`
    )
  }
}
