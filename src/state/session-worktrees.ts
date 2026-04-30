import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'

import type { SessionRecord, TabSession, WorktreeRecord } from './types'

import { createPrefixedId } from '../platform/id'
import { isInsideAimuxWorktreeRoot } from '../platform/worktree-paths'

const WORKTREE_COLORS = ['#7dd3fc', '#86efac', '#facc15', '#f0abfc', '#fb7185', '#c4b5fd']

export function getWorktreeColor(worktreeId: string): string {
  let hash = 0
  for (let i = 0; i < worktreeId.length; i++) {
    hash = (hash * 31 + worktreeId.charCodeAt(i)) >>> 0
  }
  return WORKTREE_COLORS[hash % WORKTREE_COLORS.length] ?? '#7dd3fc'
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

export function ensureSessionWorktrees(
  session: SessionRecord,
  now = new Date().toISOString()
): SessionRecord {
  if (session.worktrees?.length) {
    const worktrees = mergeExistingGitWorktrees(
      pruneMissingAimuxTempWorktrees(session.worktrees),
      now
    )
    if (worktrees.length === 0 && session.projectPath) {
      const worktree = createPrimaryWorktree(session.projectPath, now)
      return { ...session, activeWorktreeId: worktree.id, worktrees: [worktree] }
    }
    const activeWorktreeId = worktrees.some((w) => w.id === session.activeWorktreeId)
      ? session.activeWorktreeId
      : worktrees[0]?.id
    const active = worktrees.find((w) => w.id === activeWorktreeId)
    return {
      ...session,
      activeWorktreeId,
      projectPath: active?.path ?? session.projectPath,
      worktrees,
    }
  }

  if (!session.projectPath) {
    return session
  }

  const worktree = createPrimaryWorktree(session.projectPath, now)
  const worktrees = mergeExistingGitWorktrees([worktree], now)
  return {
    ...session,
    activeWorktreeId:
      worktrees.find((entry) => entry.path === session.projectPath)?.id ?? worktree.id,
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

  const byPath = new Map(worktrees.map((worktree) => [worktree.path, worktree]))
  const repoRoot =
    worktrees.find((worktree) => worktree.source === 'primary')?.repoRoot ?? anchor.repoRoot
  for (const entry of discovered) {
    if (byPath.has(entry.path)) continue
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
  return [...byPath.values()]
}

function listGitWorktreesSync(
  cwd: string
): Array<{ path: string; head?: string; branch?: string }> {
  const result = spawnSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
  })
  if (result.status !== 0 || !result.stdout) return []
  const worktrees: Array<{ path: string; head?: string; branch?: string }> = []
  let current: { path: string; head?: string; branch?: string } | null = null
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current)
      current = { path: line.slice('worktree '.length) }
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length)
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    }
  }
  if (current) worktrees.push(current)
  return worktrees
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

export function getActiveWorktree(session: SessionRecord | undefined): WorktreeRecord | undefined {
  if (!session?.worktrees?.length) return undefined
  return (
    session.worktrees.find((worktree) => worktree.id === session.activeWorktreeId) ??
    session.worktrees[0]
  )
}

export function getSessionProjectPath(session: SessionRecord | undefined): string | undefined {
  return getActiveWorktree(session)?.path ?? session?.projectPath
}

export function withActiveWorktree(session: SessionRecord, worktreeId: string): SessionRecord {
  const worktree = session.worktrees?.find((entry) => entry.id === worktreeId)
  if (!worktree) return session
  return {
    ...session,
    activeWorktreeId: worktreeId,
    projectPath: worktree.path,
    updatedAt: new Date().toISOString(),
  }
}

export function getRenderedTabWorktreeId(
  tab: { worktreeId?: string },
  worktrees: Array<{ id: string }>
): string {
  return tab.worktreeId ?? worktrees[0]?.id ?? '__main__'
}

export function orderTabsByWorktree(
  tabs: TabSession[],
  session: SessionRecord | undefined
): TabSession[] {
  const worktrees = session?.worktrees ?? []
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
