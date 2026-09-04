import { $ } from 'bun'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  gitCommitStaged,
  gitDiffOf,
  gitDiscard,
  gitStage,
  gitUnstage,
} from '../../src/git/plugin-git-writes'

/**
 * Git in writing, against a real repository: stage, unstage, diff, discard,
 * commit — and a refusal with git's own words when there is nothing to do.
 */
let repo = ''

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'aimux-git-writes-'))
  await $`git -C ${repo} init -q`.quiet()
  await $`git -C ${repo} config user.email t@t`.quiet()
  await $`git -C ${repo} config user.name t`.quiet()
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  await $`git -C ${repo} add a.txt`.quiet()
  await $`git -C ${repo} commit -q -m init`.quiet()
})

afterEach(() => {
  rmSync(repo, { force: true, recursive: true })
})

describe('plugin git writes', () => {
  test('stage, diff staged, unstage, commit', async () => {
    writeFileSync(join(repo, 'a.txt'), 'two\n')
    expect(await gitDiffOf(repo, 'a.txt')).toContain('+two')
    await gitStage(repo, ['a.txt'])
    expect(await gitDiffOf(repo, 'a.txt', { staged: true })).toContain('+two')
    expect(await gitDiffOf(repo, 'a.txt')).toBe('')
    await gitUnstage(repo, ['a.txt'])
    expect(await gitDiffOf(repo, 'a.txt', { staged: true })).toBe('')
    await gitStage(repo, ['a.txt'])
    await gitCommitStaged(repo, { body: 'why', title: 'change a' })
    const head = Bun.spawnSync(['git', '-C', repo, 'log', '-1', '--pretty=%s']).stdout.toString()
    expect(head.trim()).toBe('change a')
  })

  test('discard restores a tracked file and deletes an untracked one', async () => {
    writeFileSync(join(repo, 'a.txt'), 'three\n')
    writeFileSync(join(repo, 'new.txt'), 'x\n')
    await gitDiscard(repo, ['a.txt', 'new.txt'])
    expect(await Bun.file(join(repo, 'a.txt')).text()).toBe('one\n')
    expect(await Bun.file(join(repo, 'new.txt')).exists()).toBe(false)
  })

  test('committing nothing rejects with git’s message', async () => {
    expect(gitCommitStaged(repo, { title: 'empty' })).rejects.toThrow()
    expect(gitStage(repo, [])).rejects.toThrow('no paths')
  })
})
