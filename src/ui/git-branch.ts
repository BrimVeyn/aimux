import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * `.git` is a directory in a normal checkout and a `gitdir: <path>` pointer
 * file inside a worktree — which is what every aimux-created workspace is.
 */
function gitDirOf(cwd: string): string {
  const dotGit = join(cwd, '.git')
  if (statSync(dotGit).isDirectory()) return dotGit
  const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim()
  if (pointer == null || pointer === '') throw new Error('unreadable .git pointer')
  return isAbsolute(pointer) ? pointer : resolve(cwd, pointer)
}

/**
 * Current branch name, or null when detached (or when `cwd` is not a checkout) —
 * the same contract as `git branch --show-current`, from one file read instead
 * of a subprocess.
 *
 * The branch poller calls this for every workspace of every project every four
 * seconds. Spawning git there cost ~35ms a tick on a 13-workspace setup; the
 * reads cost ~0.1ms.
 */
export function getCurrentBranch(cwd: string): string | null {
  try {
    const head = readFileSync(join(gitDirOf(cwd), 'HEAD'), 'utf8').trim()
    return /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1] ?? null
  } catch {
    return null
  }
}
