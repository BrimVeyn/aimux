import { $ } from 'bun'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface DirectoryResult {
  path: string
  isWorktree: boolean
}

export async function searchDirectories(query: string): Promise<DirectoryResult[]> {
  if (!query.trim()) {
    return []
  }

  const home = homedir()

  try {
    const result =
      await $`find ${home} -maxdepth 4 -name .git -not -path '*/node_modules/*' -not -path '*/target/*' -not -path '*/dist/*' | sed 's|/\.git$||' | fzf --filter=${query} --no-sort | head -10`.quiet()
    const paths = result
      .text()
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)

    return Promise.all(
      paths.map(async (p) => {
        const gitPath = join(p, '.git')
        const st = await stat(gitPath).catch(() => null)
        return { path: p, isWorktree: st !== null && st.isFile() }
      })
    )
  } catch {
    return []
  }
}
