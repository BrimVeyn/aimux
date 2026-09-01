import { expect, test } from 'bun:test'

import type { AppState, GitFileEntry } from '../../src/state/types'

import { emptyGitPanel } from '../../src/state/reducers/git-panel-state'
import { appReducer, createInitialState } from '../../src/state/store'

function seedState(): AppState {
  return createInitialState()
}

function entry(overrides: Partial<GitFileEntry> = {}): GitFileEntry {
  return {
    added: 0,
    path: 'f.ts',
    removed: 0,
    section: 'unstaged',
    status: 'M',
    ...overrides,
  }
}

test('git-panel-reset clears cached diffs so a switched workspace fetches fresh', () => {
  const base = seedState()
  const s0: AppState = {
    ...base,
    gitMode: {
      ...base.gitMode,
      diffs: { 'unstaged:f.ts': { path: 'f.ts', rawDiff: 'stale', status: 'modified' } },
      selectedEntryKey: 'unstaged:f.ts',
    },
    gitPanel: { ...base.gitPanel, branch: 'main', files: [entry()] },
  }
  const s1 = appReducer(s0, { type: 'git-panel-reset' })
  expect(Object.keys(s1.gitMode.diffs)).toHaveLength(0)
  expect(s1.gitMode.selectedEntryKey).toBeNull()
  expect(s1.gitPanel.files).toHaveLength(0)
})

test('git-refresh-success replaces files + branch state', () => {
  const s0 = seedState()
  const files = [entry({ path: 'a.ts' }), entry({ path: 'b.ts' })]
  const s1 = appReducer(s0, {
    payload: { ahead: 1, behind: 0, branch: 'main', files },
    type: 'git-refresh-success',
  })
  expect(s1.gitPanel.branch).toBe('main')
  expect(s1.gitPanel.ahead).toBe(1)
  expect(s1.gitPanel.files).toHaveLength(2)
  expect(s1.gitPanel.error).toBeNull()
})

test('git-refresh-success is idempotent on unchanged payload', () => {
  const s0 = seedState()
  const files = [entry({ path: 'a.ts' })]
  const s1 = appReducer(s0, {
    payload: { ahead: 0, behind: 0, branch: 'main', files },
    type: 'git-refresh-success',
  })
  const s2 = appReducer(s1, {
    payload: { ahead: 0, behind: 0, branch: 'main', files: [entry({ path: 'a.ts' })] },
    type: 'git-refresh-success',
  })
  expect(s2).toBe(s1)
})

test('git-refresh-error clears files and stores kind', () => {
  const preloaded = {
    ...seedState(),
    gitPanel: { ...emptyGitPanel(), files: [entry()] },
  }
  const s1 = appReducer(preloaded, { kind: 'not-a-repo', type: 'git-refresh-error' })
  expect(s1.gitPanel.error).toBe('not-a-repo')
  expect(s1.gitPanel.files).toHaveLength(0)
})

test('git-refresh-success sorts files deterministically by section then path', () => {
  const s0 = seedState()
  const s1 = appReducer(s0, {
    payload: {
      ahead: 0,
      behind: 0,
      branch: 'main',
      files: [entry({ path: 'b.ts' }), entry({ path: 'a.ts' })],
    },
    type: 'git-refresh-success',
  })
  expect(s1.gitPanel.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts'])
  const s2 = appReducer(s1, {
    payload: {
      ahead: 0,
      behind: 0,
      branch: 'main',
      files: [entry({ path: 'a.ts' }), entry({ path: 'b.ts' })],
    },
    type: 'git-refresh-success',
  })
  expect(s2).toBe(s1)
})

test('git-panel-reset wipes gitPanel state', () => {
  const s0 = seedState()
  const s1 = appReducer(s0, {
    payload: {
      ahead: 2,
      behind: 1,
      branch: 'feature',
      files: [entry({ path: 'a.ts' })],
    },
    type: 'git-refresh-success',
  })
  const s2 = appReducer(s1, { type: 'git-panel-reset' })
  expect(s2.gitPanel.branch).toBeNull()
  expect(s2.gitPanel.files).toHaveLength(0)
  expect(s2.gitPanel.ahead).toBe(0)
  expect(s2.gitPanel.behind).toBe(0)
  expect(s2.gitPanel.error).toBeNull()
})

test('git-panel-reset is idempotent when already empty', () => {
  const s0 = seedState()
  const s1 = appReducer(s0, { type: 'git-panel-reset' })
  expect(s1).toBe(s0)
})
