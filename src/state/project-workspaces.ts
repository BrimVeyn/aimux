import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'

import type { BranchDivergence, ProjectRecord, TabSession, WorkspaceRecord } from './types'

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
 * Whether tabs can be opened where the project currently sits. aimux works in
 * worktrees, so the repo checkout — and a project that has nothing else — is
 * not somewhere a tab can live. One predicate so the `<C-n>` guard and the
 * empty-state advice can never tell the user two different stories.
 */
export function acceptsTabs(project: ProjectRecord | undefined): boolean {
  const workspace = getActiveWorkspace(project)
  return workspace != null && workspace.source !== 'primary'
}

/** `4823` -> `4.8k`, so a churn number never widens the sidebar row. */
export function formatDiffCount(value: number): string {
  if (value < 1_000) return String(value)
  const thousands = value / 1_000
  if (thousands < 10) return `${thousands.toFixed(1).replace(/\.0$/, '')}k`
  return `${Math.round(thousands)}k`
}

/** `+149 -629` — lines the workspace changed since it forked. Empty when clean. */
export function formatDiffStat(divergence: BranchDivergence | undefined): {
  added: string
  removed: string
} {
  const added = divergence?.added ?? 0
  const removed = divergence?.removed ?? 0
  return {
    added: added > 0 ? `+${formatDiffCount(added)}` : '',
    removed: removed > 0 ? `-${formatDiffCount(removed)}` : '',
  }
}

export function createPrimaryWorkspace(projectPath: string, now: string): WorkspaceRecord {
  const id = createPrefixedId('workspace')
  return {
    createdAt: now,
    createdByAimux: false,
    id,
    name: basename(projectPath) || projectPath,
    path: projectPath,
    repoRoot: projectPath,
    source: 'primary',
    updatedAt: now,
  }
}

export function ensureProjectWorkspaces(
  project: ProjectRecord,
  now = new Date().toISOString()
): ProjectRecord {
  if (project.workspaces?.length != null && project.workspaces?.length !== 0) {
    const workspaces = mergeExistingGitWorktrees(
      pruneMissingAimuxTempWorkspaces(project.workspaces),
      now
    )
    if (workspaces.length === 0 && project.projectPath != null && project.projectPath !== '') {
      const workspace = createPrimaryWorkspace(project.projectPath, now)
      return { ...project, activeWorkspaceId: workspace.id, workspaces: [workspace] }
    }
    // Never *default* to the primary checkout: aimux works in worktrees, and
    // tabs cannot be opened on the repo itself. An explicit selection is still
    // honoured — the user may want to sit on main to read the git panel.
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

export function getActiveWorkspace(
  project: ProjectRecord | undefined
): WorkspaceRecord | undefined {
  if (!(project?.workspaces?.length != null && project?.workspaces?.length !== 0)) return undefined
  return (
    project.workspaces.find((workspace) => workspace.id === project.activeWorkspaceId) ??
    project.workspaces[0]
  )
}

/**
 * The cwd to work in: the active workspace's path, falling back to the project
 * root. Not the same as `project.projectPath`, which names the repo itself.
 */
export function getActiveWorkspacePath(project: ProjectRecord | undefined): string | undefined {
  return getActiveWorkspace(project)?.path ?? project?.projectPath
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

export function getRenderedTabWorkspaceId(
  tab: { workspaceId?: string },
  workspaces: { id: string }[]
): string {
  return tab.workspaceId ?? workspaces[0]?.id ?? '__main__'
}

export function filterTabsForActiveWorkspace(
  tabs: TabSession[],
  project: ProjectRecord | undefined
): TabSession[] {
  if (!project) return tabs
  const activeWorkspaceId = project.activeWorkspaceId
  if (activeWorkspaceId == null || activeWorkspaceId === '') return tabs
  const workspaces = project.workspaces ?? []
  const primaryId = workspaces[0]?.id
  const activeIsPrimary = primaryId != null && primaryId === activeWorkspaceId
  return tabs.filter((tab) => {
    const owned = tab.workspaceId != null && tab.workspaceId !== ''
    if (owned) return tab.workspaceId === activeWorkspaceId
    // Unbound (legacy) tabs surface only under the primary workspace.
    return activeIsPrimary
  })
}

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
