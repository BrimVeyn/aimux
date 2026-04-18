import { expect, test } from 'bun:test'

import type { AppState, DiffData, GitFileEntry } from '../../src/state/types'

import { gitFileKey, gitFolderKey } from '../../src/state/git-tree'
import { appReducer, createInitialState } from '../../src/state/store'

function entry(path: string): GitFileEntry {
  return { added: 0, path, removed: 0, section: 'unstaged', status: 'M' }
}

function seedWithFiles(files: GitFileEntry[]): AppState {
  const base = createInitialState()
  const s0: AppState = { ...base, gitPane: { ...base.gitPane, treeCompaction: false } }
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

test('enter-git-mode sets focusMode to git and selects the first visible row', () => {
  const s0 = seedWithFiles([entry('a.ts')])
  const s1 = appReducer(s0, { type: 'enter-git-mode' })
  expect(s1.focusMode).toBe('git')
  expect(s1.gitMode.selectedEntryKey).toBe('unstaged:a.ts')
})

test('exit-git-mode returns to navigation mode', () => {
  const s0 = seedWithFiles([entry('a.ts')])
  const s1 = appReducer(s0, { type: 'enter-git-mode' })
  const s2 = appReducer(s1, { type: 'exit-git-mode' })
  expect(s2.focusMode).toBe('navigation')
})

test('git-mode-move-selection cycles through visible rows with modulo', () => {
  const s0 = seedWithFiles([entry('a.ts'), entry('b.ts'), entry('c.ts')])
  const s1 = appReducer(s0, { type: 'enter-git-mode' })
  const s2 = appReducer(s1, { delta: 1, type: 'git-mode-move-selection' })
  expect(s2.gitMode.selectedEntryKey).toBe('unstaged:b.ts')
  const s3 = appReducer(s2, { delta: 1, type: 'git-mode-move-selection' })
  expect(s3.gitMode.selectedEntryKey).toBe('unstaged:c.ts')
  const s4 = appReducer(s3, { delta: 1, type: 'git-mode-move-selection' })
  expect(s4.gitMode.selectedEntryKey).toBe('unstaged:a.ts')
  const s5 = appReducer(s4, { delta: -1, type: 'git-mode-move-selection' })
  expect(s5.gitMode.selectedEntryKey).toBe('unstaged:c.ts')
})

test('git-mode-move-selection is no-op when files empty', () => {
  const s0 = createInitialState()
  const s1 = appReducer(s0, { type: 'enter-git-mode' })
  const s2 = appReducer(s1, { delta: 1, type: 'git-mode-move-selection' })
  expect(s2).toBe(s1)
})

test('git-mode-collapse-selection collapses folders and then moves to parent', () => {
  let state = seedWithFiles([entry('src/ui/a.ts')])
  state = appReducer(state, { type: 'enter-git-mode' })
  expect(state.gitMode.selectedEntryKey).toBe(gitFolderKey('unstaged', 'src'))
  state = appReducer(state, { delta: 1, type: 'git-mode-move-selection' })
  expect(state.gitMode.selectedEntryKey).toBe(gitFolderKey('unstaged', 'src/ui'))
  const collapsed = appReducer(state, { type: 'git-mode-collapse-selection' })
  expect(collapsed.gitMode.collapsedFolders[gitFolderKey('unstaged', 'src/ui')]).toBe(true)
  const parent = appReducer(collapsed, { type: 'git-mode-collapse-selection' })
  expect(parent.gitMode.selectedEntryKey).toBe(gitFolderKey('unstaged', 'src'))
})

test('git-mode-expand-selection expands a collapsed folder', () => {
  let state = seedWithFiles([entry('src/ui/a.ts')])
  state = appReducer(state, { type: 'enter-git-mode' })
  state = appReducer(state, {
    key: gitFolderKey('unstaged', 'src'),
    type: 'git-mode-toggle-folder',
  })
  expect(state.gitMode.collapsedFolders[gitFolderKey('unstaged', 'src')]).toBe(true)
  const next = appReducer(state, { type: 'git-mode-expand-selection' })
  expect(next.gitMode.collapsedFolders[gitFolderKey('unstaged', 'src')]).toBeUndefined()
})

test('git-mode-toggle-file-list-mode switches to flat mode and reselects a file', () => {
  let state = seedWithFiles([entry('src/ui/a.ts')])
  state = appReducer(state, { type: 'enter-git-mode' })
  expect(state.gitMode.selectedEntryKey).toBe(gitFolderKey('unstaged', 'src'))
  const next = appReducer(state, { type: 'git-mode-toggle-file-list-mode' })
  expect(next.gitPane.fileListMode).toBe('flat')
  expect(next.gitMode.selectedEntryKey).toBe('unstaged:src/ui/a.ts')
})

test('git-mode-move-file-selection skips folder entries', () => {
  let state = seedWithFiles([entry('src/a.ts'), entry('src/b.ts')])
  state = appReducer(state, { type: 'enter-git-mode' })
  expect(state.gitMode.selectedEntryKey).toBe(gitFolderKey('unstaged', 'src'))
  state = appReducer(state, { delta: 1, type: 'git-mode-move-file-selection' })
  expect(state.gitMode.selectedEntryKey).toBe('unstaged:src/a.ts')
  state = appReducer(state, { delta: 1, type: 'git-mode-move-file-selection' })
  expect(state.gitMode.selectedEntryKey).toBe('unstaged:src/b.ts')
})

test('git-mode-optimistic-move follows the selected file to its new section key', () => {
  const files: GitFileEntry[] = [
    { added: 0, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' },
    { added: 0, path: 'b.ts', removed: 0, section: 'unstaged', status: 'M' },
    { added: 0, path: 'c.ts', removed: 0, section: 'unstaged', status: 'M' },
  ]
  let state = seedWithFiles(files)
  state = appReducer(state, { type: 'enter-git-mode' })
  state = appReducer(state, { delta: 1, type: 'git-mode-move-selection' })
  expect(state.gitMode.selectedEntryKey).toBe('unstaged:b.ts')
  const next = appReducer(state, {
    fromSection: 'unstaged',
    path: 'b.ts',
    toSection: 'staged',
    type: 'git-mode-optimistic-move',
  })
  expect(next.gitPanel.files[0]?.path).toBe('b.ts')
  expect(next.gitPanel.files[0]?.section).toBe('staged')
  expect(next.gitMode.selectedEntryKey).toBe('staged:b.ts')
  expect(next.gitPanel.files[1]?.path).toBe('a.ts')
})

test('git-mode-optimistic-move removing a selected file advances to the next visible row', () => {
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
  expect(next.gitMode.selectedEntryKey).toBe('untracked:b.ts')
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
    key: gitFileKey({ path: 'a.ts', section: 'unstaged' }),
    loading: true,
    type: 'git-mode-set-loading',
  })
  expect(s1.gitMode.loading['unstaged:a.ts']).toBe(true)
  const s2 = appReducer(s1, {
    diff: diffFor('a.ts'),
    hash: 'h',
    key: gitFileKey({ path: 'a.ts', section: 'unstaged' }),
    type: 'git-mode-set-diff',
  })
  expect(s2.gitMode.diffs['unstaged:a.ts']?.rawDiff).toContain('+b')
  expect(s2.gitMode.loading['unstaged:a.ts']).toBeUndefined()
})

test('git-mode diff cache stays isolated for the same path in different sections', () => {
  const files: GitFileEntry[] = [
    { added: 1, path: 'src/app.ts', removed: 0, section: 'staged', status: 'M' },
    { added: 1, path: 'src/app.ts', removed: 0, section: 'unstaged', status: 'M' },
  ]
  const s0 = seedWithFiles(files)
  const stagedKey = gitFileKey({ path: 'src/app.ts', section: 'staged' })
  const s1 = appReducer(s0, { key: stagedKey, loading: true, type: 'git-mode-set-loading' })
  const s2 = appReducer(s1, {
    diff: diffFor('src/app.ts'),
    hash: 'h',
    key: stagedKey,
    type: 'git-mode-set-diff',
  })
  expect(s2.gitMode.diffs[stagedKey]).toBeDefined()
  expect(s2.gitMode.diffs['unstaged:src/app.ts']).toBeUndefined()
  expect(s2.gitMode.loading['unstaged:src/app.ts']).toBeUndefined()
})
