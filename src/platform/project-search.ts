import { $ } from 'bun'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { DirectoryResult } from '../state/types'

import { logDebug } from '../debug/input-log'

interface DirectoryCache {
  repoPaths: string[]
  projectSet: Set<string>
  cachedAt: number
}

const CACHE_TTL_MS = 60_000
let directoryCache: DirectoryCache | null = null

async function buildCache(): Promise<DirectoryCache> {
  const home = homedir()
  try {
    const gitResult =
      await $`find ${home} -maxdepth 4 -name .git -not -path '*/node_modules/*' -not -path '*/target/*' -not -path '*/dist/*' 2>/dev/null`
        .quiet()
        .nothrow()
    const repoPaths = gitResult
      .text()
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((p) => p.replace(/\/\.git$/, ''))

    const repoSet = new Set(repoPaths)
    const parentCount = new Map<string, number>()
    for (const repo of repoPaths) {
      const parent = dirname(repo)
      if (!repoSet.has(parent)) {
        parentCount.set(parent, (parentCount.get(parent) ?? 0) + 1)
      }
    }
    const projectPaths = [...parentCount.entries()]
      .filter(([, count]) => count >= 2)
      .map(([p]) => p)

    return { cachedAt: Date.now(), projectSet: new Set(projectPaths), repoPaths }
  } catch (error) {
    logDebug('platform.projectSearch.buildCache.error', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { cachedAt: Date.now(), projectSet: new Set(), repoPaths: [] }
  }
}

async function getOrBuildCache(): Promise<DirectoryCache> {
  if (directoryCache && Date.now() - directoryCache.cachedAt < CACHE_TTL_MS) {
    return directoryCache
  }
  directoryCache = await buildCache()
  return directoryCache
}

export async function warmDirectoryCache(): Promise<void> {
  await getOrBuildCache()
}

export async function searchProjectDirectories(query: string): Promise<DirectoryResult[]> {
  if (!query.trim()) {
    return []
  }

  try {
    const cache = await getOrBuildCache()
    const allPaths = [...cache.repoPaths, ...cache.projectSet].join('\n')

    const filtered =
      await $`printf '%s' ${allPaths} | fzf --filter=${query} --no-sort | head -50`.quiet()
    const resultPaths = filtered
      .text()
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)

    resultPaths.sort((a, b) => a.length - b.length)
    resultPaths.splice(10)

    if (resultPaths.length === 0 && query.trim().startsWith('/')) {
      return [{ path: query.trim(), type: 'git-repo' }]
    }

    return Promise.all(
      resultPaths.map(async (path) => {
        if (cache.projectSet.has(path)) {
          return { path, type: 'project' as const }
        }
        const gitPath = join(path, '.git')
        const st = await stat(gitPath).catch(() => null)
        const type = st !== null && st.isFile() ? 'worktree' : 'git-repo'
        return { path, type } as const
      })
    )
  } catch (error) {
    logDebug('platform.projectSearch.error', {
      error: error instanceof Error ? error.message : String(error),
      query,
    })
    return []
  }
}
