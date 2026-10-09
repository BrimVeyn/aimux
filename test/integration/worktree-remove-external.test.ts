import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isForceableWorkspaceDeleteError } from '../../src/app-runtime/workspace-actions'
import { removeGitWorktree } from '../../src/git/worktree'

// A worktree aimux adopted rather than created. Removing only its record left it
// in `git worktree list`, so the next load adopted it right back.
describe('removeGitWorktree on an external worktree', () => {
  let base: string
  let mainRepo: string
  let worktree: string
  let previousRoot: string | undefined

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'aimux-wt-external-')))
    previousRoot = process.env.AIMUX_WORKTREE_ROOT
    process.env.AIMUX_WORKTREE_ROOT = join(base, 'worktrees')
    mainRepo = join(base, 'main')
    worktree = join(base, 'elsewhere')
    execFileSync('git', ['init', mainRepo], { stdio: 'ignore' })
    const git = (...args: string[]) => execFileSync('git', args, { cwd: mainRepo, stdio: 'ignore' })
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    git('commit', '--allow-empty', '-m', 'init')
    git('worktree', 'add', '-b', 'feature', worktree)
  })

  afterEach(() => {
    if (previousRoot === undefined) delete process.env.AIMUX_WORKTREE_ROOT
    else process.env.AIMUX_WORKTREE_ROOT = previousRoot
    rmSync(base, { force: true, recursive: true })
  })

  test('removes it from git so it is not adopted again', async () => {
    await removeGitWorktree({ force: false, repoPath: mainRepo, targetPath: worktree })
    expect(existsSync(worktree)).toBe(false)
    const list = execFileSync('git', ['worktree', 'list'], { cwd: mainRepo }).toString()
    expect(list).not.toContain(worktree)
  })

  test('a dirty one is kept and offered a force delete', async () => {
    writeFileSync(join(worktree, 'wip.txt'), 'work')
    let message = ''
    try {
      await removeGitWorktree({ force: false, repoPath: mainRepo, targetPath: worktree })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(isForceableWorkspaceDeleteError(message)).toBe(true)
    expect(existsSync(join(worktree, 'wip.txt'))).toBe(true)
  })

  test('never removes the main checkout', async () => {
    const failure = await removeGitWorktree({
      force: true,
      repoPath: mainRepo,
      targetPath: mainRepo,
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(existsSync(mainRepo)).toBe(true)
  })
})
