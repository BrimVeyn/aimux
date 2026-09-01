import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isForceableWorkspaceDeleteError } from '../../src/app-runtime/workspace-actions'
import { removeGitWorktree } from '../../src/git/worktree'

// A worktree git no longer links to — the state left by a half-finished removal
// or by moving the repo. `git worktree remove` fatals on it forever, so without
// the force fallback the workspace row can never be deleted.
describe('removeGitWorktree on an orphaned worktree directory', () => {
  let base: string
  let mainRepo: string
  let worktree: string
  let previousRoot: string | undefined

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'aimux-wt-orphan-')))
    previousRoot = process.env.AIMUX_WORKTREE_ROOT
    process.env.AIMUX_WORKTREE_ROOT = join(base, 'worktrees')
    mainRepo = join(base, 'main')
    worktree = join(base, 'worktrees', 'r-test', 'wt')
    execFileSync('git', ['init', mainRepo], { stdio: 'ignore' })
    const git = (...args: string[]) => execFileSync('git', args, { cwd: mainRepo, stdio: 'ignore' })
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    git('commit', '--allow-empty', '-m', 'init')
    git('worktree', 'add', '-b', 'feature', worktree)
    // Break the link the way the real failures do.
    rmSync(join(worktree, '.git'), { force: true })
  })

  afterEach(() => {
    if (previousRoot === undefined) delete process.env.AIMUX_WORKTREE_ROOT
    else process.env.AIMUX_WORKTREE_ROOT = previousRoot
    rmSync(base, { force: true, recursive: true })
  })

  test('without force it reports an error the UI offers to force past', async () => {
    let message = ''
    try {
      await removeGitWorktree({ force: false, repoPath: mainRepo, targetPath: worktree })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).not.toBe('')
    expect(isForceableWorkspaceDeleteError(message)).toBe(true)
    expect(existsSync(worktree)).toBe(true)
  })

  test('with force it removes the leftover directory and prunes git admin state', async () => {
    await removeGitWorktree({ force: true, repoPath: mainRepo, targetPath: worktree })
    expect(existsSync(worktree)).toBe(false)
    const list = execFileSync('git', ['worktree', 'list'], { cwd: mainRepo }).toString()
    expect(list).not.toContain(worktree)
  })
})
