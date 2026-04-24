import type { Dirent } from 'node:fs'

import { readdir, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'

import type { DiscoveredRepo } from '../state/types'

const IGNORED_DIRS = new Set(['node_modules', 'target', 'dist', 'build', '.git'])

async function isGitRepo(path: string): Promise<boolean> {
  try {
    const st = await stat(join(path, '.git'))
    return st.isDirectory() || st.isFile()
  } catch {
    return false
  }
}

/**
 * Recursively scan `projectPath` down to `maxDepth` levels for directories
 * that are themselves git repos. `maxDepth = 1` means only direct children.
 *
 * Internal recursion is breadth-limited: once a `.git` is found at a given
 * path, we don't descend into it further (nested git repos-in-repos are rare
 * and would duplicate status noise).
 */
async function scan(
  root: string,
  current: string,
  depth: number,
  maxDepth: number,
  out: DiscoveredRepo[]
): Promise<void> {
  if (depth > maxDepth) return
  let entries: Dirent[] = []
  try {
    entries = (await readdir(current, { withFileTypes: true })) as Dirent[]
  } catch {
    return
  }
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory()) return
      if (entry.name.startsWith('.')) return
      if (IGNORED_DIRS.has(entry.name)) return
      const childPath = join(current, entry.name)
      if (await isGitRepo(childPath)) {
        const rel = relative(root, childPath)
        out.push({ isRoot: false, name: rel || entry.name, path: childPath })
        return
      }
      await scan(root, childPath, depth + 1, maxDepth, out)
    })
  )
}

async function discoverReposUncached(
  projectPath: string,
  maxDepth: number
): Promise<DiscoveredRepo[]> {
  const repos: DiscoveredRepo[] = []
  if (await isGitRepo(projectPath)) {
    repos.push({ isRoot: true, name: basename(projectPath), path: projectPath })
  }
  const children: DiscoveredRepo[] = []
  await scan(projectPath, projectPath, 1, maxDepth, children)
  children.sort((a, b) => a.name.localeCompare(b.name))
  repos.push(...children)
  return repos
}

interface CacheEntry {
  maxDepth: number
  repos: DiscoveredRepo[]
}

const cache = new Map<string, CacheEntry>()

/**
 * Cached variant. The cache key is `projectPath` + `maxDepth`: a depth change
 * invalidates the entry. The cache persists until `invalidateRepoCache()` or
 * process exit — discovery is one-shot per session per depth setting.
 */
export async function discoverRepos(projectPath: string, maxDepth = 1): Promise<DiscoveredRepo[]> {
  const existing = cache.get(projectPath)
  if (existing && existing.maxDepth === maxDepth) return existing.repos
  const repos = await discoverReposUncached(projectPath, maxDepth)
  cache.set(projectPath, { maxDepth, repos })
  return repos
}

export function invalidateRepoCache(projectPath?: string): void {
  if (projectPath === undefined) cache.clear()
  else cache.delete(projectPath)
}
