import { $ } from 'bun'

export type MoveWorktreeResult =
  | { kind: 'ok'; filesChanged: number }
  | { kind: 'dirty-target' }
  | { kind: 'conflict'; files: string[] }
  | { kind: 'error'; message: string }

async function workingTreeDirty(repoPath: string): Promise<boolean> {
  const result = await $`git -C ${repoPath} status --porcelain`.quiet().nothrow()
  if (result.exitCode !== 0) return false
  return result.text().trim() !== ''
}

// Files left with conflict markers by a failed squash (unmerged index entries).
async function conflictedFiles(repoPath: string): Promise<string[]> {
  const result = await $`git -C ${repoPath} diff --name-only --diff-filter=U`.quiet().nothrow()
  if (result.exitCode !== 0) return []
  return result
    .text()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

async function countStaged(repoPath: string): Promise<number> {
  const result = await $`git -C ${repoPath} diff --cached --name-only`.quiet().nothrow()
  if (result.exitCode !== 0) return 0
  return result
    .text()
    .split('\n')
    .filter((line) => line.trim() !== '').length
}

// Squashes everything a source worktree changed since its fork point into the
// target worktree's working tree (staged, uncommitted) — committed work plus
// any uncommitted/untracked changes. The source is left exactly as it was; the
// caller decides whether to delete it. The target must be clean so two change
// sets are never silently fused. On conflict nothing is kept: the target is
// reset and the source restored.
export async function moveWorktree(opts: {
  sourcePath: string
  sourceBranch: string
  targetPath: string
}): Promise<MoveWorktreeResult> {
  const { sourceBranch, sourcePath, targetPath } = opts
  try {
    if (await workingTreeDirty(targetPath)) return { kind: 'dirty-target' }

    const headResult = await $`git -C ${sourcePath} rev-parse HEAD`.quiet().nothrow()
    if (headResult.exitCode !== 0) {
      return { kind: 'error', message: 'could not resolve source HEAD' }
    }
    const sourceHead = headResult.text().trim()

    // Capture uncommitted + untracked work in a throwaway commit so the squash
    // includes everything; undone again before we return.
    const tempCommitted = await workingTreeDirty(sourcePath)
    if (tempCommitted) {
      await $`git -C ${sourcePath} add -A`.quiet().nothrow()
      const commit = await $`git -C ${sourcePath} commit -m ${'aimux: move WIP'} --no-verify`
        .quiet()
        .nothrow()
      if (commit.exitCode !== 0) {
        const message = commit.stderr.toString().trim()
        return {
          kind: 'error',
          message: message !== '' ? message : 'failed to stage source changes',
        }
      }
    }

    const restoreSource = async (): Promise<void> => {
      if (tempCommitted) {
        await $`git -C ${sourcePath} reset --mixed ${sourceHead}`.quiet().nothrow()
      }
    }

    const merge = await $`git -C ${targetPath} merge --squash ${sourceBranch}`.quiet().nothrow()
    const conflicts = await conflictedFiles(targetPath)
    if (merge.exitCode !== 0 || conflicts.length > 0) {
      await $`git -C ${targetPath} merge --abort`.quiet().nothrow()
      await $`git -C ${targetPath} reset --hard HEAD`.quiet().nothrow()
      await restoreSource()
      if (conflicts.length > 0) return { files: conflicts, kind: 'conflict' }
      const message = merge.stderr.toString().trim()
      return { kind: 'error', message: message !== '' ? message : 'merge failed' }
    }

    const filesChanged = await countStaged(targetPath)
    await restoreSource()
    return { filesChanged, kind: 'ok' }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}
