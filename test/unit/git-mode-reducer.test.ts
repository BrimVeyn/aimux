import { expect, test } from 'bun:test'

import type { AppState, DiffData, GitFileEntry } from '../../src/state/types'

import { appReducer, createInitialState } from '../../src/state/store'

function entry(path: string): GitFileEntry {
  return { added: 0, path, removed: 0, section: 'unstaged', status: 'M' }
}

function seedWithFiles(files: GitFileEntry[]): AppState {
  const s0 = createInitialState()
  return appReducer(s0, {
    payload: { ahead: 0, behind: 0, branch: 'main', files },
    type: 'git-refresh-success',
  })
}

function diffFor(path: string): DiffData {
  return {
    path,
    rawDiff: `diff --git a/${path} b/${path}\n@@ -1,1 +1,1 @@\n-a\n+b\n`,
    status: 'modified',
  }
}

test('enter-git-mode sets focusMode to git and resets selection', () => {
  const s0 = seedWithFiles([entry('a.ts')])
  const s1 = appReducer(s0, { type: 'enter-git-mode' })
  expect(s1.focusMode).toBe('git')
  expect(s1.gitMode.selectedFileIndex).toBe(0)
})

test('exit-git-mode returns to navigation mode', () => {
  const s0 = seedWithFiles([entry('a.ts')])
  const s1 = appReducer(s0, { type: 'enter-git-mode' })
  const s2 = appReducer(s1, { type: 'exit-git-mode' })
  expect(s2.focusMode).toBe('navigation')
})

test('git-mode-select-file cycles through files with modulo', () => {
  const s0 = seedWithFiles([entry('a.ts'), entry('b.ts'), entry('c.ts')])
  const s1 = appReducer(s0, { type: 'enter-git-mode' })
  const s2 = appReducer(s1, { delta: 1, type: 'git-mode-select-file' })
  expect(s2.gitMode.selectedFileIndex).toBe(1)
  const s3 = appReducer(s2, { delta: 1, type: 'git-mode-select-file' })
  expect(s3.gitMode.selectedFileIndex).toBe(2)
  const s4 = appReducer(s3, { delta: 1, type: 'git-mode-select-file' })
  expect(s4.gitMode.selectedFileIndex).toBe(0)
  const s5 = appReducer(s4, { delta: -1, type: 'git-mode-select-file' })
  expect(s5.gitMode.selectedFileIndex).toBe(2)
})

test('git-mode-select-file is no-op when files empty', () => {
  const s0 = createInitialState()
  const s1 = appReducer(s0, { type: 'enter-git-mode' })
  const s2 = appReducer(s1, { delta: 1, type: 'git-mode-select-file' })
  expect(s2).toBe(s1)
})

test('git-mode-optimistic-move moves a file to staged and keeps cursor at same index', () => {
  const files: GitFileEntry[] = [
    { added: 0, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' },
    { added: 0, path: 'b.ts', removed: 0, section: 'unstaged', status: 'M' },
    { added: 0, path: 'c.ts', removed: 0, section: 'unstaged', status: 'M' },
  ]
  let state = seedWithFiles(files)
  state = appReducer(state, { type: 'enter-git-mode' })
  state = appReducer(state, { delta: 1, type: 'git-mode-select-file' })
  expect(state.gitMode.selectedFileIndex).toBe(1)
  const next = appReducer(state, {
    fromSection: 'unstaged',
    path: 'b.ts',
    toSection: 'staged',
    type: 'git-mode-optimistic-move',
  })
  expect(next.gitPanel.files[0]?.path).toBe('b.ts')
  expect(next.gitPanel.files[0]?.section).toBe('staged')
  expect(next.gitMode.selectedFileIndex).toBe(1)
  expect(next.gitPanel.files[1]?.path).toBe('a.ts')
})

test('git-mode-optimistic-move removing a file advances cursor to next', () => {
  const files: GitFileEntry[] = [
    { added: null, path: 'a.ts', removed: null, section: 'untracked', status: '?' },
    { added: null, path: 'b.ts', removed: null, section: 'untracked', status: '?' },
  ]
  let state = seedWithFiles(files)
  state = appReducer(state, { type: 'enter-git-mode' })
  const next = appReducer(state, {
    fromSection: 'untracked',
    path: 'a.ts',
    toSection: null,
    type: 'git-mode-optimistic-move',
  })
  expect(next.gitPanel.files).toHaveLength(1)
  expect(next.gitPanel.files[0]?.path).toBe('b.ts')
  expect(next.gitMode.selectedFileIndex).toBe(0)
})

test('git-refresh-success sorts files by section order', () => {
  const s0 = createInitialState()
  const files: GitFileEntry[] = [
    { added: null, path: 'z.ts', removed: null, section: 'untracked', status: '?' },
    { added: 0, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' },
    { added: 0, path: 'm.ts', removed: 0, section: 'staged', status: 'M' },
  ]
  const s1 = appReducer(s0, {
    payload: { ahead: 0, behind: 0, branch: 'main', files },
    type: 'git-refresh-success',
  })
  expect(s1.gitPanel.files.map((f) => f.path)).toEqual(['m.ts', 'a.ts', 'z.ts'])
})

test('git-mode-set-diff stores raw diff and clears loading', () => {
  const s0 = seedWithFiles([entry('a.ts')])
  const s1 = appReducer(s0, {
    loading: true,
    path: 'a.ts',
    type: 'git-mode-set-loading',
  })
  expect(s1.gitMode.loading['a.ts']).toBe(true)
  const s2 = appReducer(s1, {
    diff: diffFor('a.ts'),
    path: 'a.ts',
    type: 'git-mode-set-diff',
  })
  expect(s2.gitMode.diffs['a.ts']?.rawDiff).toContain('+b')
  expect(s2.gitMode.loading['a.ts']).toBeUndefined()
})
