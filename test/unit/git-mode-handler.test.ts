import { actions } from '@brimveyn/aimux-config'
import { expect, test } from 'bun:test'

import type { AppState, GitFileEntry } from '../../src/state/types'

import { appReducer, createInitialState } from '../../src/state/store'

const {
  exitGitMode,
  gitCommitOpen,
  gitDestructiveSelected,
  gitPush,
  gitStageSelected,
  scrollGitDiff,
  selectGitFile,
} = actions

function entry(path: string): GitFileEntry {
  return { added: 0, path, removed: 0, section: 'unstaged', status: 'M' }
}

function seedWithFiles(files: GitFileEntry[]): AppState {
  const s0 = createInitialState()
  const s1 = appReducer(s0, {
    payload: { ahead: 0, behind: 0, branch: 'main', files },
    type: 'git-refresh-success',
  })
  return appReducer(s1, { type: 'enter-git-mode' })
}

test('git-mode Esc transitions back to navigation with exit action', () => {
  expect(exitGitMode.transition).toBe('navigation')
  expect(exitGitMode.actions[0]).toEqual({ type: 'exit-git-mode' })
})

test('git-mode j emits select-file action with no fetch side effect', () => {
  const state = seedWithFiles([entry('a.ts'), entry('b.ts')])
  const result = selectGitFile(1)({ state })
  expect(result?.actions).toEqual([{ delta: 1, type: 'git-mode-select-file' }])
  expect(result?.effects).toEqual([])
})

test('git-mode Ctrl+d emits scroll-git-diff effect (20 lines)', () => {
  const result = scrollGitDiff(20)
  expect(result.actions).toEqual([])
  expect(result.effects).toEqual([{ delta: 20, type: 'scroll-git-diff' }])
})

test('git-mode Ctrl+u emits scroll-git-diff up effect (20 lines)', () => {
  const result = scrollGitDiff(-20)
  expect(result.effects).toEqual([{ delta: -20, type: 'scroll-git-diff' }])
})

test('git-mode Down emits single-line scroll effect', () => {
  const result = scrollGitDiff(1)
  expect(result.effects).toEqual([{ delta: 1, type: 'scroll-git-diff' }])
})

test('git-mode a stages an unstaged file with optimistic move', () => {
  const state = seedWithFiles([
    { added: 0, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' },
  ])
  const result = gitStageSelected({ state })
  expect(result?.actions).toContainEqual({
    fromSection: 'unstaged',
    path: 'a.ts',
    toSection: 'staged',
    type: 'git-mode-optimistic-move',
  })
  expect(result?.effects).toEqual([{ path: 'a.ts', type: 'git-stage' }])
})

test('git-mode a is a no-op when file already staged', () => {
  const state = seedWithFiles([
    { added: 0, path: 'a.ts', removed: 0, section: 'staged', status: 'M' },
  ])
  const result = gitStageSelected({ state })
  expect(result?.effects).toEqual([])
})

test('git-mode d unstages a staged modified file with optimistic move', () => {
  const state = seedWithFiles([
    { added: 0, path: 'a.ts', removed: 0, section: 'staged', status: 'M' },
  ])
  const result = gitDestructiveSelected({ state })
  expect(result?.actions).toContainEqual({
    fromSection: 'staged',
    path: 'a.ts',
    toSection: 'unstaged',
    type: 'git-mode-optimistic-move',
  })
  expect(result?.effects).toEqual([{ path: 'a.ts', type: 'git-unstage' }])
})

test('git-mode d unstages a staged added file back to untracked', () => {
  const state = seedWithFiles([
    { added: 0, path: 'new.ts', removed: 0, section: 'staged', status: 'A' },
  ])
  const result = gitDestructiveSelected({ state })
  expect(result?.actions).toContainEqual({
    fromSection: 'staged',
    path: 'new.ts',
    toSection: 'untracked',
    type: 'git-mode-optimistic-move',
  })
})

test('git-mode d on unstaged file asks for confirmation first', () => {
  const state = seedWithFiles([
    { added: 0, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' },
  ])
  const result = gitDestructiveSelected({ state })
  expect(result?.actions).toEqual([{ path: 'a.ts', type: 'git-mode-set-pending-delete' }])
  expect(result?.effects).toEqual([])
})

test('git-mode second d on unstaged confirms restore with optimistic remove', () => {
  let state = seedWithFiles([
    { added: 0, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' },
  ])
  state = appReducer(state, { path: 'a.ts', type: 'git-mode-set-pending-delete' })
  const result = gitDestructiveSelected({ state })
  expect(result?.actions).toContainEqual({
    fromSection: 'unstaged',
    path: 'a.ts',
    toSection: null,
    type: 'git-mode-optimistic-move',
  })
  expect(result?.effects).toEqual([{ path: 'a.ts', type: 'git-restore' }])
})

test('git-mode second d on untracked removes the file with optimistic remove', () => {
  let state = seedWithFiles([
    { added: null, path: 'new.ts', removed: null, section: 'untracked', status: '?' },
  ])
  state = appReducer(state, { path: 'new.ts', type: 'git-mode-set-pending-delete' })
  const result = gitDestructiveSelected({ state })
  expect(result?.actions).toContainEqual({
    fromSection: 'untracked',
    path: 'new.ts',
    toSection: null,
    type: 'git-mode-optimistic-move',
  })
  expect(result?.effects).toEqual([{ path: 'new.ts', type: 'git-rm' }])
})

test('git-mode c opens commit modal with transition', () => {
  const state = seedWithFiles([entry('a.ts')])
  const result = gitCommitOpen({ state })
  expect(result?.transition).toBe('modal.git-commit')
  expect(result?.actions).toContainEqual({ type: 'open-git-commit-modal' })
})

test('git-mode p triggers push effect', () => {
  const state = seedWithFiles([entry('a.ts')])
  const result = gitPush({ state })
  expect(result?.effects).toEqual([{ type: 'git-push' }])
})
