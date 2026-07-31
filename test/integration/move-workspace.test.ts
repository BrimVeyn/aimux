import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { moveWorkspace } from '../../src/git/move-workspace'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

describe('moveWorkspace', () => {
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

    const result = await moveWorkspace({
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

  test('moves into a dirty target when the changes do not overlap', async () => {
    writeFileSync(join(feature, 'file.txt'), 'base\nfeature\n')
    git(feature, 'commit', '-am', 'feature work')
    // Unrelated dirty file in the target must not block the move.
    writeFileSync(join(main, 'other.txt'), 'local edit\n')

    const result = await moveWorkspace({
      sourceBranch: 'feature',
      sourcePath: feature,
      targetPath: main,
    })

    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.stashedTarget).toBe(false)
    expect(readFileSync(join(main, 'file.txt'), 'utf8')).toBe('base\nfeature\n')
    // The target's own dirty file is preserved, untouched.
    expect(readFileSync(join(main, 'other.txt'), 'utf8')).toBe('local edit\n')
  })

  test('returns needs-stash when target dirty files overlap, touching nothing', async () => {
    writeFileSync(join(feature, 'file.txt'), 'base\nfeature\n')
    git(feature, 'commit', '-am', 'feature work')
    const featureHead = git(feature, 'rev-parse', 'HEAD').trim()
    writeFileSync(join(feature, 'wip.txt'), 'wip\n')
    writeFileSync(join(main, 'file.txt'), 'base\nlocal edit\n')

    const result = await moveWorkspace({
      sourceBranch: 'feature',
      sourcePath: feature,
      targetPath: main,
    })

    expect(result.kind).toBe('needs-stash')
    if (result.kind === 'needs-stash') expect(result.files).toContain('file.txt')
    // Target untouched.
    expect(readFileSync(join(main, 'file.txt'), 'utf8')).toBe('base\nlocal edit\n')
    // Source restored: HEAD unchanged, WIP still present.
    expect(git(feature, 'rev-parse', 'HEAD').trim()).toBe(featureHead)
    expect(readFileSync(join(feature, 'wip.txt'), 'utf8')).toBe('wip\n')
  })

  test('returns needs-stash when an untracked target file collides', async () => {
    writeFileSync(join(feature, 'new.txt'), 'from feature\n')
    git(feature, 'add', '-A')
    git(feature, 'commit', '-m', 'add new file')
    // Same path exists untracked in the target.
    writeFileSync(join(main, 'new.txt'), 'local untracked\n')

    const result = await moveWorkspace({
      sourceBranch: 'feature',
      sourcePath: feature,
      targetPath: main,
    })

    expect(result.kind).toBe('needs-stash')
    if (result.kind === 'needs-stash') expect(result.files).toContain('new.txt')
    expect(readFileSync(join(main, 'new.txt'), 'utf8')).toBe('local untracked\n')
  })

  test('stashTarget stashes the overlapping changes and completes the move', async () => {
    writeFileSync(join(feature, 'file.txt'), 'base\nfeature\n')
    git(feature, 'commit', '-am', 'feature work')
    writeFileSync(join(main, 'file.txt'), 'base\nlocal edit\n')

    const result = await moveWorkspace({
      sourceBranch: 'feature',
      sourcePath: feature,
      stashTarget: true,
      targetPath: main,
    })

    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.stashedTarget).toBe(true)
    expect(readFileSync(join(main, 'file.txt'), 'utf8')).toBe('base\nfeature\n')
    // The target's previous changes are recoverable from the stash.
    expect(git(main, 'stash', 'list')).toContain('aimux: backup before move from feature')
  })

  test('reports conflicts and restores both workspaces', async () => {
    writeFileSync(join(feature, 'file.txt'), 'base\nfrom-feature\n')
    git(feature, 'commit', '-am', 'feature change')
    const featureHead = git(feature, 'rev-parse', 'HEAD').trim()
    // Diverge the target with a conflicting commit (target stays clean).
    writeFileSync(join(main, 'file.txt'), 'base\nfrom-main\n')
    git(main, 'commit', '-am', 'main change')
    const mainHead = git(main, 'rev-parse', 'HEAD').trim()

    const result = await moveWorkspace({
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

  test('a conflict abort preserves unrelated dirty files in the target', async () => {
    writeFileSync(join(feature, 'file.txt'), 'base\nfrom-feature\n')
    git(feature, 'commit', '-am', 'feature change')
    writeFileSync(join(main, 'file.txt'), 'base\nfrom-main\n')
    git(main, 'commit', '-am', 'main change')
    // Unrelated dirty file must survive the abort (reset --merge, not --hard).
    writeFileSync(join(main, 'notes.txt'), 'precious local notes\n')

    const result = await moveWorkspace({
      sourceBranch: 'feature',
      sourcePath: feature,
      targetPath: main,
    })

    expect(result.kind).toBe('conflict')
    expect(readFileSync(join(main, 'notes.txt'), 'utf8')).toBe('precious local notes\n')
    expect(readFileSync(join(main, 'file.txt'), 'utf8')).toBe('base\nfrom-main\n')
  })

  test('keepConflicts leaves the conflicted squash in the target, source restored', async () => {
    writeFileSync(join(feature, 'file.txt'), 'base\nfrom-feature\n')
    git(feature, 'commit', '-am', 'feature change')
    const featureHead = git(feature, 'rev-parse', 'HEAD').trim()
    writeFileSync(join(feature, 'wip.txt'), 'wip\n')
    writeFileSync(join(main, 'file.txt'), 'base\nfrom-main\n')
    git(main, 'commit', '-am', 'main change')

    const result = await moveWorkspace({
      keepConflicts: true,
      sourceBranch: 'feature',
      sourcePath: feature,
      targetPath: main,
    })

    expect(result.kind).toBe('conflict-kept')
    if (result.kind === 'conflict-kept') expect(result.files).toContain('file.txt')
    // Conflict markers left in the target for manual resolution.
    expect(readFileSync(join(main, 'file.txt'), 'utf8')).toContain('<<<<<<<')
    expect(git(main, 'diff', '--name-only', '--diff-filter=U')).toContain('file.txt')
    // Source fully restored: HEAD unchanged, WIP still present.
    expect(git(feature, 'rev-parse', 'HEAD').trim()).toBe(featureHead)
    expect(readFileSync(join(feature, 'wip.txt'), 'utf8')).toBe('wip\n')
  })
})
