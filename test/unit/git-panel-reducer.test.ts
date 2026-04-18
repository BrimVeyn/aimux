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

test('toggle-git-pane flips visibility', () => {
  const s0 = seedState()
  const s1 = appReducer(s0, { type: 'toggle-git-pane' })
  expect(s1.gitPane.visible).toBe(false)
  const s2 = appReducer(s1, { type: 'toggle-git-pane' })
  expect(s2.gitPane.visible).toBe(true)
})

test('toggle-git-pane reveals hidden sidebar when enabling in embedded mode', () => {
  const s0 = seedState()
  const hidden = {
    ...s0,
    gitPane: { ...s0.gitPane, visible: false },
    sidebar: { ...s0.sidebar, visible: false },
  }
  const s1 = appReducer(hidden, { type: 'toggle-git-pane' })
  expect(s1.sidebar.visible).toBe(true)
  expect(s1.gitPane.visible).toBe(true)
})

test('resize-git-pane adjusts ratio', () => {
  const s0 = seedState()
  expect(s0.gitPane.ratio).toBe(0.5)
  const s1 = appReducer(s0, { delta: 0.1, type: 'resize-git-pane' })
  expect(s1.gitPane.ratio).toBeCloseTo(0.6)
})

test('resize-git-diff-pane adjusts diff mode ratio', () => {
  const s0 = seedState()
  expect(s0.gitPane.diffModeRatio).toBe(0.35)
  const s1 = appReducer(s0, { delta: 0.1, type: 'resize-git-diff-pane' })
  expect(s1.gitPane.diffModeRatio).toBeCloseTo(0.45)
  expect(s1.gitPane.ratio).toBe(0.5)
})

test('resize-git-pane clamps at bounds', () => {
  const s0 = seedState()
  const up = appReducer(s0, { delta: 2, type: 'resize-git-pane' })
  expect(up.gitPane.ratio).toBe(0.8)
  const down = appReducer(s0, { delta: -2, type: 'resize-git-pane' })
  expect(down.gitPane.ratio).toBe(0.2)
})

test('resize-git-pane returns same state at bound', () => {
  const s0 = seedState()
  const maxed = appReducer(s0, { delta: 2, type: 'resize-git-pane' })
  const again = appReducer(maxed, { delta: 1, type: 'resize-git-pane' })
  expect(again).toBe(maxed)
})

test('set-git-pane-mode normalizes invalid position', () => {
  const s0 = seedState()
  const paneMode = appReducer(s0, { mode: 'pane', type: 'set-git-pane-mode' })
  expect(paneMode.gitPane.mode).toBe('pane')
  expect(paneMode.gitPane.position).toBe('left')
  const back = appReducer(paneMode, { mode: 'embedded', type: 'set-git-pane-mode' })
  expect(back.gitPane.mode).toBe('embedded')
  expect(back.gitPane.position).toBe('bottom')
})

test('set-git-pane-position rejects invalid position for current mode', () => {
  const s0 = seedState()
  const unchanged = appReducer(s0, { position: 'left', type: 'set-git-pane-position' })
  expect(unchanged).toBe(s0)
  const top = appReducer(s0, { position: 'top', type: 'set-git-pane-position' })
  expect(top.gitPane.position).toBe('top')
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
