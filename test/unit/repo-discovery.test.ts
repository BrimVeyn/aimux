import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverRepos, invalidateRepoCache } from '../../src/git/repo-discovery'

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'aimux-repo-discovery-'))
  await mkdir(join(root, '.git'))
  await mkdir(join(root, 'a', '.git'), { recursive: true })
  await mkdir(join(root, 'b'), { recursive: true })
  await writeFile(join(root, 'b', '.git'), 'gitdir: /some/other')
  await mkdir(join(root, 'not-a-repo'))
  await mkdir(join(root, 'node_modules', 'pkg', '.git'), { recursive: true })
  // depth-2 repo for maxDepth test
  await mkdir(join(root, 'deep', 'nested', '.git'), { recursive: true })
})

afterAll(async () => {
  await rm(root, { force: true, recursive: true })
})

afterEach(() => {
  invalidateRepoCache()
})

test('discovers root + direct child repos (dir + file-style) at depth 1', async () => {
  const repos = await discoverRepos(root, 1)
  const names = repos.map((r) => r.name)
  expect(repos.some((r) => r.isRoot)).toBe(true)
  expect(names).toContain('a')
  expect(names).toContain('b')
  expect(names).not.toContain('not-a-repo')
  expect(names).not.toContain('node_modules')
  // depth-2 'nested' should NOT appear yet
  expect(names.some((n) => n.includes('nested'))).toBe(false)
})

test('maxDepth=2 walks into non-repo directories to find nested repos', async () => {
  const repos = await discoverRepos(root, 2)
  const names = repos.map((r) => r.name)
  expect(names.some((n) => n.includes('nested'))).toBe(true)
})

test('cache returns the same array when called twice with same depth', async () => {
  const a = await discoverRepos(root, 1)
  const b = await discoverRepos(root, 1)
  expect(a).toBe(b)
})

test('cache invalidates when depth changes', async () => {
  const a = await discoverRepos(root, 1)
  const b = await discoverRepos(root, 2)
  expect(a).not.toBe(b)
})

test('returns empty for a non-existent path', async () => {
  const repos = await discoverRepos(join(root, 'does-not-exist'), 1)
  expect(repos).toEqual([])
})
