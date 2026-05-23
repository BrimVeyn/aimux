import { $ } from 'bun'
import { existsSync } from 'node:fs'

import { isInsideAimuxWorktreeRoot } from '../platform/worktree-paths'

export interface GitWorktreeInfo {
  path: string
  head?: string
  branch?: string
  // True when git still tracks the worktree but its directory is gone
  // (e.g. a temp dir cleared on reboot). Such entries are stale admin junk.
  prunable?: boolean
}

// Returns the main worktree's path, i.e. the original repository checkout.
// `git worktree list` always reports the main worktree first, so this stays
// correct even when called from inside a linked worktree — unlike
// `rev-parse --show-toplevel`, which returns the *current* worktree's path.
export async function getMainWorktreeRoot(cwd: string): Promise<string | undefined> {
  const worktrees = await listGitWorktrees(cwd)
  return worktrees[0]?.path
}

export async function getCurrentBranch(cwd: string): Promise<string | undefined> {
  const result = await $`git -C ${cwd} branch --show-current`.quiet().nothrow()
  if (result.exitCode !== 0) return undefined
  return result.text().trim() || undefined
}

export async function getHeadSha(cwd: string): Promise<string | undefined> {
  const result = await $`git -C ${cwd} rev-parse HEAD`.quiet().nothrow()
  if (result.exitCode !== 0) return undefined
  return result.text().trim() || undefined
}

export async function createGitWorktree({
  baseRef,
  branchName,
  repoPath,
  targetPath,
}: {
  repoPath: string
  targetPath: string
  branchName: string
  baseRef: string
}): Promise<void> {
  const result = await $`git -C ${repoPath} worktree add -b ${branchName} ${targetPath} ${baseRef}`
    .quiet()
    .nothrow()
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString().trim() || 'failed to create git worktree')
  }
}

export async function removeGitWorktree({
  force,
  repoPath,
  targetPath,
}: {
  repoPath: string
  targetPath: string
  force: boolean
}): Promise<void> {
  if (!isInsideAimuxWorktreeRoot(targetPath)) {
    throw new Error(`refusing to delete worktree outside Aimux temp root: ${targetPath}`)
  }
  const result = force
    ? await $`git -C ${repoPath} worktree remove --force ${targetPath}`.quiet().nothrow()
    : await $`git -C ${repoPath} worktree remove ${targetPath}`.quiet().nothrow()
  if (result.exitCode === 0) return
  // The worktree directory may already be gone, leaving only stale admin state
  // in the main repo. Pruning clears it so deletion still reaches its goal.
  if (!existsSync(targetPath)) {
    await $`git -C ${repoPath} worktree prune`.quiet().nothrow()
    return
  }
  throw new Error(result.stderr.toString().trim() || 'failed to remove git worktree')
}

export async function listGitWorktrees(repoPath: string): Promise<GitWorktreeInfo[]> {
  const result = await $`git -C ${repoPath} worktree list --porcelain`.quiet().nothrow()
  if (result.exitCode !== 0) return []
  const worktrees: GitWorktreeInfo[] = []
  let current: GitWorktreeInfo | null = null
  for (const line of result.text().split('\n')) {
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
