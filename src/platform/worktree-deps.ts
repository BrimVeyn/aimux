import { existsSync } from 'node:fs'
import { realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Symlink the source checkout's `node_modules` into a freshly created worktree
 * so a JS project's dependencies don't need reinstalling. No-op when the source
 * isn't a JS project, has no installed `node_modules`, or the worktree already
 * has one. Returns true when a symlink was created.
 */
export async function linkNodeModules(sourceDir: string, worktreePath: string): Promise<boolean> {
  if (!existsSync(join(sourceDir, 'package.json'))) return false
  const sourceModules = join(sourceDir, 'node_modules')
  if (!existsSync(sourceModules)) return false
  const targetModules = join(worktreePath, 'node_modules')
  if (existsSync(targetModules)) return false
  // Resolve through any existing symlink so the new link points at the real
  // dependency store rather than chaining through another worktree.
  const resolved = await realpath(sourceModules)
  await symlink(resolved, targetModules, 'dir')
  return true
}
