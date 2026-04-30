import { $ } from 'bun'

import type { ScriptFileResult } from '../state/types'

const SCRIPT_LIKE = /(^Makefile$|\.(sh|bash|zsh|js|mjs|cjs|ts|tsx)$)/

export async function searchRepoScriptFiles(
  repoPath: string | undefined,
  query: string
): Promise<ScriptFileResult[]> {
  if (!repoPath || !query.trim()) return []
  const result = await $`git -C ${repoPath} ls-files`.quiet().nothrow()
  if (result.exitCode !== 0) return []
  const q = query.trim().toLowerCase()
  return result
    .text()
    .split('\n')
    .filter(Boolean)
    .filter((path) => path.toLowerCase().includes(q))
    .sort(
      (a, b) => Number(!SCRIPT_LIKE.test(a)) - Number(!SCRIPT_LIKE.test(b)) || a.length - b.length
    )
    .slice(0, 20)
    .map((path) => ({ path: `./${path}` }))
}
