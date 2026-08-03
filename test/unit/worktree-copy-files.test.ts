import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadConfig, saveConfig } from '../../src/config'
import { copyWorktreeFiles } from '../../src/git/worktree-files'
import { worktreeCopyPatterns } from '../../src/settings/flags'

let root: string
let repo: string
let target: string
let homeBefore: string | undefined

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'aimux-copy-files-'))
  homeBefore = process.env.HOME
  process.env.HOME = join(root, 'home')
  repo = join(root, 'repo')
  target = join(root, 'workspace')
  await mkdir(join(repo, 'api'), { recursive: true })
  await mkdir(target, { recursive: true })
  await writeFile(join(repo, '.env'), 'SECRET=1')
  await writeFile(join(repo, '.env.local'), 'LOCAL=1')
  await writeFile(join(repo, 'api', '.env'), 'NESTED=1')
})

afterAll(async () => {
  if (homeBefore === undefined) delete process.env.HOME
  else process.env.HOME = homeBefore
  await rm(root, { force: true, recursive: true })
})

test('copies matched dotfiles, creating the directories they sit in', async () => {
  await copyWorktreeFiles(repo, target, ['.env', 'api/.env'])

  expect(await readFile(join(target, '.env'), 'utf8')).toBe('SECRET=1')
  expect(await readFile(join(target, 'api', '.env'), 'utf8')).toBe('NESTED=1')
  // Not asked for: only the listed patterns are copied.
  expect(await Bun.file(join(target, '.env.local')).exists()).toBe(false)
})

test('never overwrites what the checkout already has', async () => {
  await writeFile(join(target, '.env'), 'MINE=1')

  await copyWorktreeFiles(repo, target, ['.env'])

  expect(await readFile(join(target, '.env'), 'utf8')).toBe('MINE=1')
})

test('a pattern matching nothing is not an error', async () => {
  await copyWorktreeFiles(repo, target, ['nope/*.secret'])
})

test('git.worktreeCopyFiles decides the patterns, and empty disables it', () => {
  expect(worktreeCopyPatterns()).toEqual(['.env'])

  saveConfig({ ...loadConfig(), settings: { 'git.worktreeCopyFiles': '.env, .env.*' } })
  expect(worktreeCopyPatterns()).toEqual(['.env', '.env.*'])

  saveConfig({ ...loadConfig(), settings: { 'git.worktreeCopyFiles': '' } })
  expect(worktreeCopyPatterns()).toEqual([])
})
