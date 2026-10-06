import { $ } from 'bun'

import type { GitFileEntry } from '../state/types'

import { countUntrackedLines, parseNumstat, parsePorcelainEntries } from './git-status'

/**
 * Every file of a repository, as a file browser lists them: tracked or not,
 * changed or not. Ignored files are left out — `node_modules` is not something
 * anyone browses, and listing it is what makes a tree unusable.
 */

export interface RepoFile {
  path: string
  /** What git says has changed, or null for a file as HEAD has it. */
  change: GitFileEntry | null
  /** Lines added and removed against HEAD — staged and not, together. Null when uncounted. */
  added: number | null
  removed: number | null
}

const NO_NUMSTAT = new Map()

/**
 * One entry per path. A file can be both staged and changed again since; what
 * a viewer compares is the working tree against HEAD, so either entry leads to
 * the same diff — the staged one is kept for what only it knows (an addition,
 * a rename's old path).
 */
export function changesByPath(entries: readonly GitFileEntry[]): Map<string, GitFileEntry> {
  const out = new Map<string, GitFileEntry>()
  for (const entry of entries) {
    const held = out.get(entry.path)
    if (held === undefined || entry.section === 'staged') out.set(entry.path, entry)
  }
  return out
}

async function statusEntries(cwd: string, path?: string): Promise<GitFileEntry[]> {
  const result =
    path === undefined
      ? await $`git -C ${cwd} -c core.quotePath=false status --porcelain=v2 -z --untracked-files=all`
          .quiet()
          .nothrow()
      : await $`git -C ${cwd} -c core.quotePath=false status --porcelain=v2 -z --untracked-files=all -- ${path}`
          .quiet()
          .nothrow()
  if (result.exitCode !== 0) return []
  return parsePorcelainEntries(result.text(), NO_NUMSTAT, NO_NUMSTAT)
}

/** What has changed about one file, or null when nothing has. */
export async function fileChange(cwd: string, path: string): Promise<GitFileEntry | null> {
  const entries = await statusEntries(cwd, path)
  return changesByPath(entries.filter((e) => e.path === path)).get(path) ?? null
}

/**
 * Sorted by path. Rejects when `cwd` is not a repository.
 *
 * The counts are against HEAD, whatever is staged: a browser shows one diff per
 * file, not git mode's two sections. An untracked file is all additions.
 */
export async function listRepoFiles(cwd: string): Promise<RepoFile[]> {
  const [listed, entries, numstat] = await Promise.all([
    $`git -C ${cwd} -c core.quotePath=false ls-files -z --cached --others --exclude-standard`
      .quiet()
      .nothrow(),
    statusEntries(cwd),
    // `--no-renames`: a renamed file is counted under its new path, which is
    // the one listed. No HEAD yet (a fresh repository) is no counts, not an error.
    $`git -C ${cwd} -c core.quotePath=false diff HEAD --numstat --no-renames`.quiet().nothrow(),
  ])
  if (listed.exitCode !== 0) throw new Error(listed.stderr.toString().trim() || 'not a repository')
  const changes = changesByPath(entries)
  const paths = new Set(listed.text().split('\0'))
  paths.delete('')
  // A deletion that is staged has left the index too, and is still a change
  // worth seeing.
  for (const path of changes.keys()) paths.add(path)
  const counts = numstat.exitCode === 0 ? parseNumstat(numstat.text()) : new Map()
  const untracked = [...changes.values()].filter((change) => change.section === 'untracked')
  const lines = await Promise.all(untracked.map(async (c) => countUntrackedLines(cwd, c.path)))
  for (const [i, change] of untracked.entries()) {
    counts.set(change.path, { added: lines[i] ?? null, removed: 0 })
  }
  return [...paths].sort().map((path) => {
    const change = changes.get(path) ?? null
    const count = change === null ? undefined : counts.get(path)
    return {
      added: count?.added ?? null,
      change,
      path,
      removed: count?.removed ?? null,
    }
  })
}
