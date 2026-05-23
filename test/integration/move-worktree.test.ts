import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { moveWorktree } from '../../src/git/move-worktree'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

describe('moveWorktree', () => {
  let base: string
  let main: string
  let feature: string

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'aimux-move-')))
    main = join(base, 'main')
    feature = join(base, 'feature')
    execFileSync('git', ['init', main], { stdio: 'ignore' })
    git(main, 'config', 'user.email', 'test@example.com')
    git(main, 'config', 'user.name', 'Test')
    writeFileSync(join(main, 'file.txt'), 'base\n')
    git(main, 'add', '-A')
    git(main, 'commit', '-m', 'init')
    git(main, 'worktree', 'add', '-b', 'feature', feature)
  })

  afterEach(() => {
    rmSync(base, { force: true, recursive: true })
  })

  test('squashes committed + uncommitted + untracked work into target, staged', async () => {
    writeFileSync(join(feature, 'file.txt'), 'base\ncommitted\n')
    git(feature, 'commit', '-am', 'feature work')
    const featureHead = git(feature, 'rev-parse', 'HEAD').trim()
    // Leave uncommitted + untracked changes too.
    writeFileSync(join(feature, 'file.txt'), 'base\ncommitted\nuncommitted\n')
    writeFileSync(join(feature, 'new.txt'), 'brand new\n')

    const result = await moveWorktree({
      sourceBranch: 'feature',
      sourcePath: feature,
      targetPath: main,
    })

    expect(result.kind).toBe('ok')
    // Target now carries everything feature changed, staged & uncommitted.
    expect(readFileSync(join(main, 'file.txt'), 'utf8')).toBe('base\ncommitted\nuncommitted\n')
    expect(readFileSync(join(main, 'new.txt'), 'utf8')).toBe('brand new\n')
    const staged = git(main, 'diff', '--cached', '--name-only')
    expect(staged).toContain('file.txt')
    expect(staged).toContain('new.txt')
    // Source is left exactly as it was: HEAD unchanged, WIP still present.
    expect(git(feature, 'rev-parse', 'HEAD').trim()).toBe(featureHead)
    expect(readFileSync(join(feature, 'file.txt'), 'utf8')).toBe('base\ncommitted\nuncommitted\n')
  })

  test('refuses when the target worktree is dirty', async () => {
    writeFileSync(join(feature, 'file.txt'), 'base\nfeature\n')
    git(feature, 'commit', '-am', 'feature work')
    writeFileSync(join(main, 'file.txt'), 'base\nlocal edit\n')

    const result = await moveWorktree({
      sourceBranch: 'feature',
      sourcePath: feature,
      targetPath: main,
    })

    expect(result.kind).toBe('dirty-target')
    // Target untouched.
    expect(readFileSync(join(main, 'file.txt'), 'utf8')).toBe('base\nlocal edit\n')
  })

  test('reports conflicts and restores both worktrees', async () => {
    writeFileSync(join(feature, 'file.txt'), 'base\nfrom-feature\n')
    git(feature, 'commit', '-am', 'feature change')
    const featureHead = git(feature, 'rev-parse', 'HEAD').trim()
    // Diverge the target with a conflicting commit (target stays clean).
    writeFileSync(join(main, 'file.txt'), 'base\nfrom-main\n')
    git(main, 'commit', '-am', 'main change')
    const mainHead = git(main, 'rev-parse', 'HEAD').trim()

    const result = await moveWorktree({
      sourceBranch: 'feature',
      sourcePath: feature,
      targetPath: main,
    })

    expect(result.kind).toBe('conflict')
    // Target reset to a clean HEAD; source unchanged.
    expect(git(main, 'status', '--porcelain').trim()).toBe('')
    expect(git(main, 'rev-parse', 'HEAD').trim()).toBe(mainHead)
    expect(git(feature, 'rev-parse', 'HEAD').trim()).toBe(featureHead)
  })
})
