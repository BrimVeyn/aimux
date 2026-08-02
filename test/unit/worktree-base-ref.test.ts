import { $ } from 'bun'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createGitWorktree, resolveGitRef, resolveWorktreeBaseRef } from '../../src/git/worktree'

/**
 * A remote with a commit the clone has never seen, which is the whole point:
 * forking from the local `main` here would start a workspace one commit behind.
 */
let root: string
let remote: string
let clone: string
let homeBefore: string | undefined

async function commit(repo: string, message: string): Promise<void> {
  await writeFile(join(repo, `${message}.txt`), message)
  await $`git -C ${repo} add -A`.quiet()
  await $`git -C ${repo} commit -m ${message}`.quiet()
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'aimux-base-ref-'))
  // The config file gates the fetch, and it is read from $HOME — without this the
  // test would pass or fail on whether the machine running it has it turned off.
  homeBefore = process.env.HOME
  process.env.HOME = join(root, 'home')

  remote = join(root, 'remote')
  clone = join(root, 'clone')
  await $`git init -b main ${remote}`.quiet()
  await $`git -C ${remote} config user.email test@example.com`.quiet()
  await $`git -C ${remote} config user.name test`.quiet()
  await commit(remote, 'first')
  await $`git clone ${remote} ${clone}`.quiet()
  await commit(remote, 'second')
})

afterAll(async () => {
  if (homeBefore === undefined) delete process.env.HOME
  else process.env.HOME = homeBefore
  await rm(root, { force: true, recursive: true })
})

test('a base with a counterpart on origin resolves to it, fetched', async () => {
  const localBefore = await resolveGitRef(clone, 'main')

  expect(await resolveWorktreeBaseRef(clone, 'main')).toBe('origin/main')

  // The fetch has to have happened: origin/main now holds the commit the clone
  // was created before, while the local main still sits where it was.
  expect(await resolveGitRef(clone, 'origin/main')).toBe(
    (await resolveGitRef(remote, 'main')) ?? 'unresolved'
  )
  expect(await resolveGitRef(clone, 'main')).toBe(localBefore ?? 'unresolved')
})

test('a base with no counterpart on origin is used as given', async () => {
  await $`git -C ${clone} branch local-only`.quiet()

  expect(await resolveWorktreeBaseRef(clone, 'local-only')).toBe('local-only')
  // Already qualified: `origin/origin/main` is not a ref, so it stays put rather
  // than growing a second prefix.
  expect(await resolveWorktreeBaseRef(clone, 'origin/main')).toBe('origin/main')
})

test('a workspace forked from the refreshed base has the commit, and no upstream', async () => {
  const target = join(root, 'workspace')

  const forkRef = await createGitWorktree({
    baseRef: 'main',
    branchName: 'aimux/from-origin',
    repoPath: clone,
    targetPath: target,
  })

  expect(forkRef).toBe('origin/main')
  // The commit the clone never had: the point of the whole exercise.
  expect(await resolveGitRef(target, 'HEAD')).toBe((await resolveGitRef(remote, 'main')) ?? 'none')
  // No upstream, or the git pane's push would run a bare `git push` against main.
  const upstream = await $`git -C ${target} rev-parse --abbrev-ref --symbolic-full-name @{u}`
    .quiet()
    .nothrow()
  expect(upstream.exitCode).not.toBe(0)
})

test('a repo with no origin at all still yields a usable base', async () => {
  const solo = join(root, 'solo')
  await $`git init -b main ${solo}`.quiet()
  await $`git -C ${solo} config user.email test@example.com`.quiet()
  await $`git -C ${solo} config user.name test`.quiet()
  await commit(solo, 'only')

  // The failing fetch is swallowed on purpose — offline is not a reason to
  // refuse to create a workspace.
  expect(await resolveWorktreeBaseRef(solo, 'main')).toBe('main')
})
