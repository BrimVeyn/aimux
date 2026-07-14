import { $ } from 'bun'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { GitFileEntry } from '../../src/state/types'

import { MAX_DIFF_BYTES } from '../../src/git/diff-limits'
import { fetchDiff } from '../../src/git/git-diff'
import { collectGitStatus } from '../../src/git/git-status'

let repo: string

// Just past the guard. The bug was never about the exact size — a real download cache
// runs to gigabytes — but the guard is what we are pinning, and a few MB pins it without
// writing gigabytes to a temp dir on every test run.
const OVERSIZE = MAX_DIFF_BYTES + 1024

function untracked(path: string): GitFileEntry {
  return { path, section: 'untracked', status: '?' } as GitFileEntry
}

function modified(path: string): GitFileEntry {
  return { path, section: 'unstaged', status: 'M' } as GitFileEntry
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'aimux-git-size-'))
  await $`git -C ${repo} init -q`.quiet()
  await $`git -C ${repo} config user.email test@aimux.dev`.quiet()
  await $`git -C ${repo} config user.name test`.quiet()

  await writeFile(join(repo, 'seed.txt'), 'seed\n')
  await $`git -C ${repo} add -A`.quiet()
  await $`git -C ${repo} commit -qm seed`.quiet()

  // The crash shape: an untracked, oversized, NUL-bearing blob dropped into the working
  // tree by a downloader. `git status --untracked-files=all` lists it individually.
  const blob = new Uint8Array(OVERSIZE)
  blob[0] = 0x50
  blob[1] = 0x4b // PK — zip magic; the NULs that follow make git call it binary
  await writeFile(join(repo, 'huge.zip'), blob)

  // Oversized but genuinely text: must be refused on size alone, not on binaryness.
  await writeFile(join(repo, 'huge.csv'), 'a,b\n'.repeat(OVERSIZE / 4))

  // Untracked and small: the guards must not swallow the ordinary case.
  await writeFile(join(repo, 'small.ts'), 'export const x = 1\n')
})

afterAll(async () => {
  await rm(repo, { force: true, recursive: true })
})

// The regression that took the TUI down: countUntrackedLines read every untracked file
// into a string to count newlines, so a multi-gigabyte download aborted the process
// (SIGTRAP) the moment the git poller ran — before any file was even selected.
test('git status does not read oversized untracked files to count their lines', async () => {
  const result = await collectGitStatus(repo)
  expect(result.kind).toBe('ok')
  if (result.kind !== 'ok') return

  const byPath = new Map(result.payload.files.map((f) => [f.path, f]))

  // Left at the parser's null — no count was annotated, because the contents were never
  // read at all. Before the guard these came back as line numbers.
  expect(byPath.get('huge.zip')?.added).toBeNull()
  expect(byPath.get('huge.csv')?.added).toBeNull()

  // …while a small untracked file is still counted, exactly as before.
  expect(byPath.get('small.ts')?.added).toBe(1)
})

test('untracked oversized binary is refused, not read into a string', async () => {
  const diff = await fetchDiff(repo, untracked('huge.zip'))
  expect(diff.status).toBe('too-large')
  expect(diff.rawDiff).toBe('')
  expect(diff.binarySizeAfter).toBe(OVERSIZE)
})

test('untracked oversized text file is refused on size alone', async () => {
  const diff = await fetchDiff(repo, untracked('huge.csv'))
  expect(diff.status).toBe('too-large')
  expect(diff.rawDiff).toBe('')
})

test('untracked small file still diffs normally', async () => {
  const diff = await fetchDiff(repo, untracked('small.ts'))
  expect(diff.status).toBe('new')
  expect(diff.rawDiff).toContain('export const x = 1')
})

test('tracked file is refused once it grows past the limit', async () => {
  await writeFile(join(repo, 'grown.txt'), 'small\n')
  await $`git -C ${repo} add grown.txt`.quiet()
  await $`git -C ${repo} commit -qm grown`.quiet()
  await writeFile(join(repo, 'grown.txt'), 'x\n'.repeat(OVERSIZE / 2))

  const diff = await fetchDiff(repo, modified('grown.txt'))
  expect(diff.status).toBe('too-large')
  expect(diff.rawDiff).toBe('')
})

test('tracked small file is unaffected', async () => {
  await writeFile(join(repo, 'seed.txt'), 'seed\nedited\n')
  const diff = await fetchDiff(repo, modified('seed.txt'))
  expect(diff.status).toBe('modified')
  expect(diff.rawDiff).toContain('edited')
})
