import { $ } from 'bun'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { DirectoryResult } from '../state/types'

import { logDebug } from '../debug/input-log'

export async function searchProjectDirectories(query: string): Promise<DirectoryResult[]> {
  if (!query.trim()) {
    return []
  }

  const home = homedir()

  try {
    // Step 1: Find all git repos (nothrow: find exits 1 on macOS permission errors)
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

    // Step 2: Find workspace parents (dirs with 2+ child repos that aren't repos themselves)
    const repoSet = new Set(repoPaths)
    const parentCount = new Map<string, number>()
    for (const repo of repoPaths) {
      const parent = dirname(repo)
      if (!repoSet.has(parent)) {
        parentCount.set(parent, (parentCount.get(parent) ?? 0) + 1)
      }
    }
    const workspacePaths = [...parentCount.entries()]
      .filter(([, count]) => count >= 2)
      .map(([p]) => p)
    const workspaceSet = new Set(workspacePaths)

    // Step 3: Combine and fuzzy filter
    const allPaths = [...repoPaths, ...workspacePaths].join('\n')
    const filtered =
      await $`printf '%s' ${allPaths} | fzf --filter=${query} --no-sort | head -50`.quiet()
    const resultPaths = filtered
      .text()
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)

    // Step 4: Classify each result (shortest paths first, limit to 10)
    resultPaths.sort((a, b) => a.length - b.length)
    resultPaths.splice(10)
    return Promise.all(
      resultPaths.map(async (path) => {
        if (workspaceSet.has(path)) {
          return { path, type: 'workspace' as const }
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
