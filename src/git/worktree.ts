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

export async function isGitWorktreeDirty(cwd: string): Promise<boolean> {
  const result = await $`git -C ${cwd} status --porcelain`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString().trim() || `failed to inspect worktree: ${cwd}`)
  }
  return result.text().trim().length > 0
}

// Local branch names, ordered most-recently-committed first so the likely base
// surfaces near the top of the picker.
export async function listLocalBranches(cwd: string): Promise<string[]> {
  // The format must be interpolated, not inlined: Bun's shell parses a bare
  // `%(refname:short)` and chokes on the parentheses.
  const format = '%(refname:short)'
  const result =
    await $`git -C ${cwd} for-each-ref --sort=-committerdate refs/heads --format=${format}`
      .quiet()
      .nothrow()
  if (result.exitCode !== 0) return []
  return result
    .text()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

// Resolve a ref to its SHA in a specific repository, or undefined when it does
// not exist there. The repo argument matters more than it looks: the same ref
// name ("main", "HEAD") resolves in almost every repo, so a caller that picked
// the wrong repository gets a *successful* resolution and no signal at all.
export async function resolveGitRef(repoPath: string, ref: string): Promise<string | undefined> {
  const result = await $`git -C ${repoPath} rev-parse --verify --quiet ${ref}`.quiet().nothrow()
  if (result.exitCode !== 0) return undefined
  return result.text().trim() || undefined
}

// The branch a new workspace forks from unless the user picks another base.
// `origin/HEAD` is the only authoritative answer; it is missing on repos cloned
// with --no-checkout or created locally, hence the name probes behind it.
export async function getDefaultBranch(repoPath: string): Promise<string | undefined> {
  const head = await $`git -C ${repoPath} symbolic-ref --short refs/remotes/origin/HEAD`
    .quiet()
    .nothrow()
  if (head.exitCode === 0) {
    const ref = head.text().trim()
    const short = ref.startsWith('origin/') ? ref.slice('origin/'.length) : ref
    if (short !== '') return short
  }
  const locals = await listLocalBranches(repoPath)
  return ['main', 'master'].find((name) => locals.includes(name))
}

// Rename a local branch. Returns false (without throwing) when git refuses —
// the target name already exists, most likely — so a failed rename leaves the
// workspace on the branch it was created with instead of losing it.
export async function renameGitBranch(
  repoPath: string,
  from: string,
  to: string
): Promise<boolean> {
  if (from === '' || to === '' || from === to) return false
  const result = await $`git -C ${repoPath} branch -m ${from} ${to}`.quiet().nothrow()
  return result.exitCode === 0
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
    // Always name the repository. A bare "fatal: not a valid object name: 'X'"
    // reads as a ref-resolution bug when the real cause is that git ran in a
    // repository the caller did not mean to target.
    const stderr = result.stderr.toString().trim()
    throw new Error(`${stderr || 'failed to create git worktree'} (in ${repoPath})`)
  }
}

// Force-delete a local branch. Returns false (without throwing) when git
// refuses — notably when the branch is still checked out in a live worktree,
// which is exactly how orphan-pruning stays safe.
export async function deleteGitBranch(repoPath: string, branch: string): Promise<boolean> {
  const result = await $`git -C ${repoPath} branch -D ${branch}`.quiet().nothrow()
  return result.exitCode === 0
}

export async function pruneGitWorktrees(repoPath: string): Promise<void> {
  await $`git -C ${repoPath} worktree prune`.quiet().nothrow()
}

// Drop every `aimux/` branch left behind by deleted temp worktrees. git refuses
// to delete branches still checked out in a live worktree, so this only removes
// true orphans. Returns the number of branches removed.
export async function pruneOrphanAimuxBranches(repoPath: string): Promise<number> {
  await pruneGitWorktrees(repoPath)
  const branches = (await listLocalBranches(repoPath)).filter((branch) =>
    branch.startsWith('aimux/')
  )
  let removed = 0
  for (const branch of branches) {
    if (await deleteGitBranch(repoPath, branch)) removed++
  }
  return removed
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
