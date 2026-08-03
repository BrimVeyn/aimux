import { Glob } from 'bun'
import { existsSync } from 'node:fs'
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { logDebug } from '../debug/input-log'

/**
 * Seed a fresh worktree with the untracked local files it needs to run.
 *
 * A worktree checkout holds tracked files and nothing else, so every ignored
 * local file — `.env` above all — is missing the moment the workspace opens.
 * The setup script can recreate some of them from a template; it cannot invent
 * the secrets, which is why they are copied from the main checkout instead.
 *
 * ponytail: the patterns are matched against the whole checkout, gitignore and
 * all — a recursive pattern walks `node_modules` too. Feeding the scan the ignore
 * rules is the upgrade path if that ever costs anything noticeable.
 *
 * Best-effort by design: a pattern that matches nothing, or a file that cannot
 * be read, must not take the workspace down with it. Nothing is ever
 * overwritten — a match that already exists in the new worktree is tracked
 * content, and clobbering it would dirty the workspace before its first commit.
 */
export async function copyWorktreeFiles(
  repoPath: string,
  targetPath: string,
  patterns: readonly string[]
): Promise<void> {
  for (const pattern of patterns) {
    try {
      const matches = new Glob(pattern).scan({ cwd: repoPath, dot: true, onlyFiles: true })
      for await (const relative of matches) {
        const to = join(targetPath, relative)
        if (existsSync(to)) continue
        await mkdir(dirname(to), { recursive: true })
        await cp(join(repoPath, relative), to)
      }
    } catch (error) {
      // A workspace without its .env still opens; a workspace that failed to be
      // created does not. Logged rather than swallowed outright: a file that
      // silently never arrives is otherwise indistinguishable from one the
      // pattern never matched.
      logDebug('worktree.seed.error', {
        error: error instanceof Error ? error.message : String(error),
        pattern,
        repoPath,
      })
    }
  }
}
