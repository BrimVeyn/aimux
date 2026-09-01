import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'

import type {
  BranchDivergence,
  ProjectRecord,
  TabSession,
  WorkspaceActivity,
  WorkspaceRecord,
} from './types'

import { createPrefixedId } from '../platform/id'
import { isInsideAimuxWorktreeRoot } from '../platform/worktree-paths'

export function formatDivergence(divergence: BranchDivergence | undefined): string {
  if (divergence == null) return ''
  const parts: string[] = []
  if (divergence.ahead > 0) parts.push(`↑${divergence.ahead}`)
  if (divergence.behind > 0) parts.push(`↓${divergence.behind}`)
  return parts.join(' ')
}

/**
 * What the repo checkout is called in the sidebar.
 *
 * Not the directory name: the project heading directly above it already says
 * that, and a row repeating its own parent is what made the two look like the
 * same thing. "root" names its role instead — the checkout the worktrees hang
 * off — and the branch under it says which one it is.
 */
export const PRIMARY_WORKSPACE_NAME = 'root'

export function createPrimaryWorkspace(projectPath: string, now: string): WorkspaceRecord {
  const id = createPrefixedId('workspace')
  return {
    createdAt: now,
    createdByAimux: false,
    id,
    name: PRIMARY_WORKSPACE_NAME,
    path: projectPath,
    repoRoot: projectPath,
    source: 'primary',
    updatedAt: now,
  }
}

/**
 * Retire the old primary name — the directory's own basename — for `root`.
 *
 * Catalogs written before the checkout had a row of its own carry it, and there
 * it duplicates the project heading it now sits under. Only that exact name is
 * replaced: anything else is a name the user chose, and it stays.
 */
function renamePrimaryFromDirectoryName(workspaces: WorkspaceRecord[]): WorkspaceRecord[] {
  return workspaces.map((workspace) =>
    workspace.source === 'primary' && workspace.name === basename(workspace.path)
      ? { ...workspace, name: PRIMARY_WORKSPACE_NAME }
      : workspace
  )
}

export function ensureProjectWorkspaces(
  project: ProjectRecord,
  now = new Date().toISOString()
): ProjectRecord {
  if (project.workspaces?.length != null && project.workspaces?.length !== 0) {
    const workspaces = renamePrimaryFromDirectoryName(
      mergeExistingGitWorktrees(pruneMissingAimuxTempWorkspaces(project.workspaces), now)
    )
    if (workspaces.length === 0 && project.projectPath != null && project.projectPath !== '') {
      const workspace = createPrimaryWorkspace(project.projectPath, now)
      return { ...project, activeWorkspaceId: workspace.id, workspaces: [workspace] }
    }
    // Prefer a worktree when the stored selection is gone: coming back to a
    // project, the branch you were on is a better guess than the trunk. Not a
    // restriction — the checkout hosts tabs like any other workspace — just
    // which one to open on. An explicit selection always wins.
    const activeWorkspaceId = workspaces.some((w) => w.id === project.activeWorkspaceId)
      ? project.activeWorkspaceId
      : (workspaces.find((w) => w.source !== 'primary') ?? workspaces[0])?.id
    return {
      ...project,
      activeWorkspaceId,
      // projectPath stays pinned to the repo. The active workspace's path is a
      // separate thing — read it with getActiveWorkspacePath.
      projectPath: workspaces.find((w) => w.source === 'primary')?.repoRoot ?? project.projectPath,
      workspaces,
    }
  }

  if (!(project.projectPath != null && project.projectPath !== '')) {
    return project
  }

  const workspace = createPrimaryWorkspace(project.projectPath, now)
  const workspaces = mergeExistingGitWorktrees([workspace], now)
  // Same rule as above: an adopted worktree wins over the repo checkout. A
  // project with nothing but its primary lands there and stays inert until
  // `<C-p>`, which is the intended funnel.
  return {
    ...project,
    activeWorkspaceId: (workspaces.find((entry) => entry.source !== 'primary') ?? workspace).id,
    workspaces,
  }
}

function stableWorkspaceId(path: string): string {
  // Keeps the `worktree-` prefix on purpose: this id is re-derived from the
  // path on every load, so changing it would re-key every adopted workspace
  // and orphan the tabs bound to them.
  return `worktree-${createHash('sha1').update(path).digest('hex').slice(0, 10)}`
}

function mergeExistingGitWorktrees(workspaces: WorkspaceRecord[], now: string): WorkspaceRecord[] {
  const anchor = workspaces.find((workspace) => existsSync(workspace.path)) ?? workspaces[0]
  if (!anchor) return workspaces
  const discovered = listGitWorktreesSync(anchor.path)
  if (discovered.length === 0) return workspaces

  // Git keeps admin entries for workspaces whose directory is gone (e.g. a temp
  // dir cleared on reboot). Drop that stale state so the entries stop
  // resurfacing in `git worktree list`, and ignore them while reconciling.
  if (discovered.some((entry) => entry.prunable === true)) {
    pruneGitWorktreesSync(anchor.path)
  }
  const live = discovered.filter((entry) => entry.prunable !== true)

  const byPath = new Map(workspaces.map((workspace) => [workspace.path, workspace]))
  // `git worktree list` reports the main workspace first; prefer the primary
  // record's repoRoot when it still exists, then git's main workspace.
  const primaryRepoRoot = workspaces.find((workspace) => workspace.source === 'primary')?.repoRoot
  const repoRoot =
    primaryRepoRoot !== undefined && existsSync(primaryRepoRoot)
      ? primaryRepoRoot
      : (live[0]?.path ?? anchor.repoRoot)
  for (const entry of live) {
    const existing = byPath.get(entry.path)
    if (existing) {
      // Patch branch / commitSha from git for entries we already track —
      // notably the primary workspace, whose `branch` is never set at creation
      // time (createPrimaryWorkspace doesn't run `git`). Without this, the UI
      // and the divergence poller have no branch for primary workspaces.
      const patchedBranch = entry.branch ?? existing.branch
      const patchedSha = entry.head ?? existing.commitSha
      if (patchedBranch !== existing.branch || patchedSha !== existing.commitSha) {
        byPath.set(entry.path, {
          ...existing,
          branch: patchedBranch,
          commitSha: patchedSha,
          updatedAt: now,
        })
      }
      continue
    }
    if (isInsideAimuxWorktreeRoot(entry.path)) continue
    const workspace: WorkspaceRecord = {
      branch: entry.branch,
      commitSha: entry.head,
      createdAt: now,
      createdByAimux: false,
      id: stableWorkspaceId(entry.path),
      name: basename(entry.path) || entry.path,
      path: entry.path,
      repoRoot,
      source: 'external',
      updatedAt: now,
    }
    byPath.set(entry.path, workspace)
  }
  return (
    [...byPath.values()]
      // Drop records whose directory no longer exists (a deleted external
      // workspace that git already pruned) so they don't reappear on restart.
      .filter((workspace) => workspace.source === 'primary' || existsSync(workspace.path))
      // Heal records whose repoRoot points at a since-deleted sibling workspace
      // so later git operations (e.g. `git -C repoRoot`) don't fail.
      .map((workspace) =>
        existsSync(workspace.repoRoot) ? workspace : { ...workspace, repoRoot, updatedAt: now }
      )
  )
}

interface DiscoveredWorkspace {
  path: string
  head?: string
  branch?: string
  prunable?: boolean
}

function listGitWorktreesSync(cwd: string): DiscoveredWorkspace[] {
  const result = spawnSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
  })
  if (result.status !== 0 || !result.stdout) return []
  const workspaces: DiscoveredWorkspace[] = []
  let current: DiscoveredWorkspace | null = null
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) workspaces.push(current)
      current = { path: line.slice('worktree '.length) }
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length)
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (current && line.startsWith('prunable')) {
      current.prunable = true
    }
  }
  if (current) workspaces.push(current)
  return workspaces
}

function pruneGitWorktreesSync(cwd: string): void {
  spawnSync('git', ['-C', cwd, 'worktree', 'prune'], { encoding: 'utf8' })
}

function pruneMissingAimuxTempWorkspaces(workspaces: WorkspaceRecord[]): WorkspaceRecord[] {
  return workspaces.filter((workspace) => {
    if (
      workspace.source !== 'aimux-temp' ||
      !workspace.createdByAimux ||
      !isInsideAimuxWorktreeRoot(workspace.path)
    ) {
      return true
    }
    return existsSync(workspace.path)
  })
}

/**
 * The project the user is in. `currentProjectId` is a nullable string that is
 * also meaningfully empty, so open-coding this lookup means repeating both
 * checks; there is one home for it instead.
 */
export function getCurrentProject(state: {
  currentProjectId?: string | null
  projects: ProjectRecord[]
}): ProjectRecord | undefined {
  const id = state.currentProjectId
  if (id == null || id === '') return undefined
  return state.projects.find((project) => project.id === id)
}

/** The project that owns a workspace, and the workspace itself. */
export function findWorkspace(
  projects: ProjectRecord[],
  workspaceId: string | undefined
): { project: ProjectRecord; workspace: WorkspaceRecord } | undefined {
  if (workspaceId == null || workspaceId === '') return undefined
  for (const project of projects) {
    const workspace = project.workspaces?.find((entry) => entry.id === workspaceId)
    if (workspace) return { project, workspace }
  }
  return undefined
}

export function withActiveWorkspace(project: ProjectRecord, workspaceId: string): ProjectRecord {
  const workspace = project.workspaces?.find((entry) => entry.id === workspaceId)
  if (!workspace) return project
  return {
    ...project,
    activeWorkspaceId: workspaceId,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Landing on a workspace — entering it, or opening one of its tabs — is what
 * "you have seen it" means, so it drops the finished-a-turn tick. Returns the
 * same map when there is nothing to clear, so every caller can spread it
 * unconditionally without churning the sidebar's subscribers.
 */
export function clearWorkspaceDone(
  workspaceActivity: Record<string, WorkspaceActivity>,
  workspaceId: string | undefined
): Record<string, WorkspaceActivity> {
  if (workspaceId == null || workspaceId === '') return workspaceActivity
  const entry = workspaceActivity[workspaceId]
  if (entry === undefined || !entry.done) return workspaceActivity
  return { ...workspaceActivity, [workspaceId]: { ...entry, done: false } }
}

export function getRenderedTabWorkspaceId(
  tab: { workspaceId?: string },
  workspaces: { id: string }[]
): string {
  return tab.workspaceId ?? workspaces[0]?.id ?? '__main__'
}

/**
 * The one gate every "which tabs does the user see" path shares: the top tab
 * bar, Leader+1..9, Ctrl+Tab, the three `activeTabId` re-picks, and flash-jump
 * labels. Hidden tabs are dropped here rather than at each caller — including
 * on the no-project / no-active-workspace paths, which must not become a hole.
 */
export function orderTabsByWorkspace(
  tabs: TabSession[],
  project: ProjectRecord | undefined
): TabSession[] {
  const workspaces = project?.workspaces ?? []
  const order = new Map<string, number>()
  for (const [index, workspace] of workspaces.entries()) {
    order.set(workspace.id, index)
  }
  order.set('__main__', order.size)

  return tabs
    .map((tab, index) => ({ index, tab }))
    .sort((a, b) => {
      const aw = order.get(getRenderedTabWorkspaceId(a.tab, workspaces)) ?? Number.MAX_SAFE_INTEGER
      const bw = order.get(getRenderedTabWorkspaceId(b.tab, workspaces)) ?? Number.MAX_SAFE_INTEGER
      if (aw !== bw) return aw - bw
      return a.index - b.index
    })
    .map((entry) => entry.tab)
}
