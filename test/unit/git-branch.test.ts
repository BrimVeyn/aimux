import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getCurrentBranch } from '../../src/ui/git-branch'

function makeCheckout(head: string): string {
  const root = mkdtempSync(join(tmpdir(), 'aimux-branch-'))
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, '.git', 'HEAD'), head)
  return root
}

/**
 * The poller reads HEAD off disk instead of spawning `git branch
 * --show-current`, so it has to reproduce that command's contract itself —
 * including the worktree indirection every aimux-created workspace uses.
 */
describe('getCurrentBranch', () => {
  test('reads a plain checkout', () => {
    expect(getCurrentBranch(makeCheckout('ref: refs/heads/main\n'))).toBe('main')
  })

  test('keeps slashes in the branch name', () => {
    expect(getCurrentBranch(makeCheckout('ref: refs/heads/feat/a/b\n'))).toBe('feat/a/b')
  })

  test('follows a worktree .git pointer file', () => {
    const repo = makeCheckout('ref: refs/heads/main\n')
    const wtGitDir = join(repo, '.git', 'worktrees', 'wt')
    mkdirSync(wtGitDir, { recursive: true })
    writeFileSync(join(wtGitDir, 'HEAD'), 'ref: refs/heads/nathan/fix/thing\n')

    const wt = mkdtempSync(join(tmpdir(), 'aimux-wt-'))
    writeFileSync(join(wt, '.git'), `gitdir: ${wtGitDir}\n`)

    expect(getCurrentBranch(wt)).toBe('nathan/fix/thing')
  })

  test('a detached HEAD has no branch, like --show-current', () => {
    expect(getCurrentBranch(makeCheckout('9fceb02aa3f4f3b1d4a2e8d9b0c1a2b3c4d5e6f7\n'))).toBeNull()
  })

  test('a path that is not a checkout reports nothing', () => {
    expect(getCurrentBranch(mkdtempSync(join(tmpdir(), 'aimux-bare-')))).toBeNull()
  })
})
