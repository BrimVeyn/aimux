import { $ } from 'bun'

import type { BranchDivergence } from '../state/types'

// Parses `git rev-list --left-right --count <base>...<branch>`, which prints two
// whitespace-separated counts: "<left> <right>". With the `<base>...<branch>`
// range the left count is commits in base but not branch (how far the branch is
// *behind* its base) and the right count is commits in branch but not base (how
// far it is *ahead*).
export function parseDivergenceCount(output: string): BranchDivergence | undefined {
  const match = /(\d+)\s+(\d+)/.exec(output.trim())
  if (match == null) return undefined
  return {
    ahead: Number.parseInt(match[2] ?? '', 10),
    behind: Number.parseInt(match[1] ?? '', 10),
  }
}

// Commits a worktree branch is ahead/behind the ref it forked from. Returns
// undefined when the refs can't be compared (missing ref, not a repo, …) so
// callers can simply render nothing.
export async function getBranchDivergence(
  repoPath: string,
  baseRef: string,
  branch: string
): Promise<BranchDivergence | undefined> {
  const range = `${baseRef}...${branch}`
  const result = await $`git -C ${repoPath} rev-list --left-right --count ${range}`
    .quiet()
    .nothrow()
  if (result.exitCode !== 0) return undefined
  return parseDivergenceCount(result.text())
}

// Fork point: the most recent commit shared by baseRef and ref. Diffing the
// working tree against this shows everything the worktree changed since it
// branched off (commits + staged + unstaged) — i.e. what a squash-move lands.
export async function getMergeBase(
  repoPath: string,
  baseRef: string,
  ref = 'HEAD'
): Promise<string | undefined> {
  const result = await $`git -C ${repoPath} merge-base ${baseRef} ${ref}`.quiet().nothrow()
  if (result.exitCode !== 0) return undefined
  return result.text().trim() || undefined
}
