import { $ } from 'bun'

import { enqueueGitOp } from './command-queue'

/**
 * Git in writing, for plugins.
 *
 * Reads were already there (`ctx.ui.git.status`); a review plugin, a hunk
 * stager, a "commit this ticket's files" helper all need the four writes
 * below and one read git mode has and the status snapshot does not: the diff.
 *
 * Every call is argv through Bun's `$`, never a shell string, and every git
 * write goes through the same queue git mode uses — two panes staging at once
 * would otherwise race on the index lock. A failure rejects with git's own
 * words; a plugin can show them or not, but it cannot miss them.
 */

async function run(cwd: string, args: readonly string[]): Promise<string> {
  const result = await $`git -C ${cwd} ${args}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString().trim() || `git ${args[0] ?? ''} failed`)
  }
  return result.stdout.toString()
}

function requirePaths(paths: readonly string[]): string[] {
  const list = paths.filter((path) => path !== '')
  if (list.length === 0) throw new Error('no paths given')
  return list
}

export async function gitDiffOf(
  cwd: string,
  path: string,
  options: { staged?: boolean } = {}
): Promise<string> {
  const args = options.staged === true ? ['diff', '--cached', '--', path] : ['diff', '--', path]
  return run(cwd, args)
}

export async function gitStage(cwd: string, paths: readonly string[]): Promise<void> {
  const list = requirePaths(paths)
  await enqueueGitOp(async () => run(cwd, ['add', '--', ...list]))
}

export async function gitUnstage(cwd: string, paths: readonly string[]): Promise<void> {
  const list = requirePaths(paths)
  await enqueueGitOp(async () => run(cwd, ['restore', '--staged', '--', ...list]))
}

/**
 * Tracked files go back to the index; untracked ones are deleted, because
 * that is the only "discard" an untracked file has. Decided per path from
 * `git ls-files`, not from the panel, so a plugin acting on a fresh listing
 * of its own is not at the mercy of the poll interval.
 */
export async function gitDiscard(cwd: string, paths: readonly string[]): Promise<void> {
  const list = requirePaths(paths)
  await enqueueGitOp(async () => {
    const tracked = new Set(
      (await run(cwd, ['ls-files', '--', ...list]))
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
    )
    const restore = list.filter((path) => tracked.has(path))
    const remove = list.filter((path) => !tracked.has(path))
    if (restore.length > 0) await run(cwd, ['checkout', '--', ...restore])
    if (remove.length > 0) await run(cwd, ['clean', '-f', '--', ...remove])
  })
}

export async function gitCommitStaged(
  cwd: string,
  input: { title: string; body?: string }
): Promise<void> {
  if (input.title.trim() === '') throw new Error('empty commit title')
  const args =
    input.body !== undefined && input.body !== ''
      ? ['commit', '-m', input.title, '-m', input.body]
      : ['commit', '-m', input.title]
  await enqueueGitOp(async () => run(cwd, args))
}
