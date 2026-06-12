import { $ } from 'bun'

export interface MoveWorktreeOptions {
  sourcePath: string
  sourceBranch: string
  targetPath: string
  /** Stash the target's uncommitted (incl. untracked) changes before merging. The stash is kept. */
  stashTarget?: boolean
  /** On conflict, leave the conflicted squash state in the target for manual resolution. */
  keepConflicts?: boolean
}

export type MoveWorktreeResult =
  | { kind: 'ok'; filesChanged: number; stashedTarget: boolean }
  /** Target dirty/untracked files would be overwritten by the move; nothing was touched. */
  | { kind: 'needs-stash'; files: string[] }
  /** Conflict; target and source fully restored. */
  | { kind: 'conflict'; files: string[] }
  /** Conflict markers left in the target on purpose; source restored. */
  | { kind: 'conflict-kept'; files: string[] }
  | { kind: 'error'; message: string }

export async function countDirtyFiles(repoPath: string): Promise<number> {
  const result = await $`git -C ${repoPath} status --porcelain`.quiet().nothrow()
  if (result.exitCode !== 0) return 0
  return result
    .text()
    .split('\n')
    .filter((line) => line.trim() !== '').length
}

async function workingTreeDirty(repoPath: string): Promise<boolean> {
  return (await countDirtyFiles(repoPath)) > 0
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

// Git refuses a merge up front (working tree untouched) when local changes
// overlap the incoming ones, listing the files tab-indented under either
// "Your local changes to the following files would be overwritten by merge:"
// or "The following untracked working tree files would be overwritten by merge:".
function parseOverwrittenFiles(output: string): string[] {
  const files: string[] = []
  let collecting = false
  for (const line of output.split('\n')) {
    if (line.includes('would be overwritten by merge')) {
      collecting = true
      continue
    }
    if (!collecting) continue
    if (line.startsWith('\t')) {
      const file = line.trim()
      if (file !== '') files.push(file)
    } else {
      collecting = false
    }
  }
  return files
}

// Squashes everything a source worktree changed since its fork point into the
// target worktree's working tree (staged, uncommitted) — committed work plus
// any uncommitted/untracked changes. The source is left exactly as it was; the
// caller decides whether to delete it. The target may be dirty as long as its
// local changes don't overlap the incoming ones: on overlap the move stops
// before touching anything (needs-stash) unless stashTarget is set. On
// conflict nothing is kept — target reset, source restored — unless
// keepConflicts is set, in which case the conflicted squash state is left in
// the target for manual resolution.
export async function moveWorktree(opts: MoveWorktreeOptions): Promise<MoveWorktreeResult> {
  const { sourceBranch, sourcePath, targetPath } = opts
  try {
    const headResult = await $`git -C ${sourcePath} rev-parse HEAD`.quiet().nothrow()
    if (headResult.exitCode !== 0) {
      return { kind: 'error', message: 'could not resolve source HEAD' }
    }
    const sourceHead = headResult.text().trim()

    let stashedTarget = false
    if (opts.stashTarget === true && (await workingTreeDirty(targetPath))) {
      const stashMessage = `aimux: backup before move from ${sourceBranch}`
      const stash = await $`git -C ${targetPath} stash push --include-untracked -m ${stashMessage}`
        .quiet()
        .nothrow()
      if (stash.exitCode !== 0) {
        const message = stash.stderr.toString().trim()
        return {
          kind: 'error',
          message: message !== '' ? message : 'failed to stash target changes',
        }
      }
      stashedTarget = true
    }

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
      if (conflicts.length > 0 && opts.keepConflicts === true) {
        await restoreSource()
        return { files: conflicts, kind: 'conflict-kept' }
      }
      if (conflicts.length === 0) {
        const overwritten = parseOverwrittenFiles(merge.stderr.toString() + merge.stdout.toString())
        if (overwritten.length > 0) {
          // Git refused up front — the target working tree was never touched.
          await restoreSource()
          return { files: overwritten, kind: 'needs-stash' }
        }
      }
      await $`git -C ${targetPath} merge --abort`.quiet().nothrow()
      // --merge (not --hard): unrelated dirty files in the target must survive.
      await $`git -C ${targetPath} reset --merge HEAD`.quiet().nothrow()
      await restoreSource()
      if (conflicts.length > 0) return { files: conflicts, kind: 'conflict' }
      const message = merge.stderr.toString().trim()
      return { kind: 'error', message: message !== '' ? message : 'merge failed' }
    }

    const filesChanged = await countStaged(targetPath)
    await restoreSource()
    return { filesChanged, kind: 'ok', stashedTarget }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}
