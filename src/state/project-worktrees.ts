import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'

import type { BranchDivergence, ProjectRecord, TabSession, WorktreeRecord } from './types'

import { createPrefixedId } from '../platform/id'
import { isInsideAimuxWorktreeRoot } from '../platform/worktree-paths'

export function formatDivergence(divergence: BranchDivergence | undefined): string {
  if (divergence == null) return ''
  const parts: string[] = []
  if (divergence.ahead > 0) parts.push(`↑${divergence.ahead}`)
  if (divergence.behind > 0) parts.push(`↓${divergence.behind}`)
  return parts.join(' ')
}

export function createPrimaryWorktree(projectPath: string, now: string): WorktreeRecord {
  const id = createPrefixedId('worktree')
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

export function ensureProjectWorktrees(
  project: ProjectRecord,
  now = new Date().toISOString()
): ProjectRecord {
  if (project.worktrees?.length != null && project.worktrees?.length !== 0) {
    const worktrees = mergeExistingGitWorktrees(
      pruneMissingAimuxTempWorktrees(project.worktrees),
      now
    )
    if (worktrees.length === 0 && project.projectPath != null && project.projectPath !== '') {
      const worktree = createPrimaryWorktree(project.projectPath, now)
      return { ...project, activeWorktreeId: worktree.id, worktrees: [worktree] }
    }
    const activeWorktreeId = worktrees.some((w) => w.id === project.activeWorktreeId)
      ? project.activeWorktreeId
      : worktrees[0]?.id
    return {
      ...project,
      activeWorktreeId,
      // projectPath stays pinned to the repo. The active worktree's path is a
      // separate thing — read it with getActiveWorktreePath.
      projectPath: worktrees.find((w) => w.source === 'primary')?.repoRoot ?? project.projectPath,
      worktrees,
    }
  }

  if (!(project.projectPath != null && project.projectPath !== '')) {
    return project
  }

  const worktree = createPrimaryWorktree(project.projectPath, now)
  const worktrees = mergeExistingGitWorktrees([worktree], now)
  return {
    ...project,
    activeWorktreeId:
      worktrees.find((entry) => entry.path === project.projectPath)?.id ?? worktree.id,
    worktrees,
  }
}

function stableWorktreeId(path: string): string {
  return `worktree-${createHash('sha1').update(path).digest('hex').slice(0, 10)}`
}

function mergeExistingGitWorktrees(worktrees: WorktreeRecord[], now: string): WorktreeRecord[] {
  const anchor = worktrees.find((worktree) => existsSync(worktree.path)) ?? worktrees[0]
  if (!anchor) return worktrees
  const discovered = listGitWorktreesSync(anchor.path)
  if (discovered.length === 0) return worktrees

  // Git keeps admin entries for worktrees whose directory is gone (e.g. a temp
  // dir cleared on reboot). Drop that stale state so the entries stop
  // resurfacing in `git worktree list`, and ignore them while reconciling.
  if (discovered.some((entry) => entry.prunable === true)) {
    pruneGitWorktreesSync(anchor.path)
  }
  const live = discovered.filter((entry) => entry.prunable !== true)

  const byPath = new Map(worktrees.map((worktree) => [worktree.path, worktree]))
  // `git worktree list` reports the main worktree first; prefer the primary
  // record's repoRoot when it still exists, then git's main worktree.
  const primaryRepoRoot = worktrees.find((worktree) => worktree.source === 'primary')?.repoRoot
  const repoRoot =
    primaryRepoRoot !== undefined && existsSync(primaryRepoRoot)
      ? primaryRepoRoot
      : (live[0]?.path ?? anchor.repoRoot)
  for (const entry of live) {
    const existing = byPath.get(entry.path)
    if (existing) {
      // Patch branch / commitSha from git for entries we already track —
      // notably the primary worktree, whose `branch` is never set at creation
      // time (createPrimaryWorktree doesn't run `git`). Without this, the UI
      // and the divergence poller have no branch for primary worktrees.
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
    const worktree: WorktreeRecord = {
      branch: entry.branch,
      commitSha: entry.head,
      createdAt: now,
      createdByAimux: false,
      id: stableWorktreeId(entry.path),
      name: basename(entry.path) || entry.path,
      path: entry.path,
      repoRoot,
      source: 'external',
      updatedAt: now,
    }
    byPath.set(entry.path, worktree)
  }
  return (
    [...byPath.values()]
      // Drop records whose directory no longer exists (a deleted external
      // worktree that git already pruned) so they don't reappear on restart.
      .filter((worktree) => worktree.source === 'primary' || existsSync(worktree.path))
      // Heal records whose repoRoot points at a since-deleted sibling worktree
      // so later git operations (e.g. `git -C repoRoot`) don't fail.
      .map((worktree) =>
        existsSync(worktree.repoRoot) ? worktree : { ...worktree, repoRoot, updatedAt: now }
      )
  )
}

interface DiscoveredWorktree {
  path: string
  head?: string
  branch?: string
  prunable?: boolean
}

function listGitWorktreesSync(cwd: string): DiscoveredWorktree[] {
  const result = spawnSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
  })
  if (result.status !== 0 || !result.stdout) return []
  const worktrees: DiscoveredWorktree[] = []
  let current: DiscoveredWorktree | null = null
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current)
      current = { path: line.slice('worktree '.length) }
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length)
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (current && line.startsWith('prunable')) {
      current.prunable = true
    }
  }
  if (current) worktrees.push(current)
  return worktrees
}

function pruneGitWorktreesSync(cwd: string): void {
  spawnSync('git', ['-C', cwd, 'worktree', 'prune'], { encoding: 'utf8' })
}

function pruneMissingAimuxTempWorktrees(worktrees: WorktreeRecord[]): WorktreeRecord[] {
  return worktrees.filter((worktree) => {
    if (
      worktree.source !== 'aimux-temp' ||
      !worktree.createdByAimux ||
      !isInsideAimuxWorktreeRoot(worktree.path)
    ) {
      return true
    }
    return existsSync(worktree.path)
  })
}

export function getActiveWorktree(project: ProjectRecord | undefined): WorktreeRecord | undefined {
  if (!(project?.worktrees?.length != null && project?.worktrees?.length !== 0)) return undefined
  return (
    project.worktrees.find((worktree) => worktree.id === project.activeWorktreeId) ??
    project.worktrees[0]
  )
}

/**
 * The cwd to work in: the active worktree's path, falling back to the project
 * root. Not the same as `project.projectPath`, which names the repo itself.
 */
export function getActiveWorktreePath(project: ProjectRecord | undefined): string | undefined {
  return getActiveWorktree(project)?.path ?? project?.projectPath
}

export function withActiveWorktree(project: ProjectRecord, worktreeId: string): ProjectRecord {
  const worktree = project.worktrees?.find((entry) => entry.id === worktreeId)
  if (!worktree) return project
  return {
    ...project,
    activeWorktreeId: worktreeId,
    updatedAt: new Date().toISOString(),
  }
}

export function getRenderedTabWorktreeId(
  tab: { worktreeId?: string },
  worktrees: { id: string }[]
): string {
  return tab.worktreeId ?? worktrees[0]?.id ?? '__main__'
}

export function filterTabsForActiveWorktree(
  tabs: TabSession[],
  project: ProjectRecord | undefined
): TabSession[] {
  if (!project) return tabs
  const activeWorktreeId = project.activeWorktreeId
  if (activeWorktreeId == null || activeWorktreeId === '') return tabs
  const worktrees = project.worktrees ?? []
  const primaryId = worktrees[0]?.id
  const activeIsPrimary = primaryId != null && primaryId === activeWorktreeId
  return tabs.filter((tab) => {
    const owned = tab.worktreeId != null && tab.worktreeId !== ''
    if (owned) return tab.worktreeId === activeWorktreeId
    // Unbound (legacy) tabs surface only under the primary worktree.
    return activeIsPrimary
  })
}

export function orderTabsByWorktree(
  tabs: TabSession[],
  project: ProjectRecord | undefined
): TabSession[] {
  const worktrees = project?.worktrees ?? []
  const order = new Map<string, number>()
  for (const [index, worktree] of worktrees.entries()) {
    order.set(worktree.id, index)
  }
  order.set('__main__', order.size)

  return tabs
    .map((tab, index) => ({ index, tab }))
    .sort((a, b) => {
      const aw = order.get(getRenderedTabWorktreeId(a.tab, worktrees)) ?? Number.MAX_SAFE_INTEGER
      const bw = order.get(getRenderedTabWorktreeId(b.tab, worktrees)) ?? Number.MAX_SAFE_INTEGER
      if (aw !== bw) return aw - bw
      return a.index - b.index
    })
    .map((entry) => entry.tab)
}
