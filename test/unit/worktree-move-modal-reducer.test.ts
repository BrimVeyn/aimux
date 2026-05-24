import { expect, test } from 'bun:test'

import type { AppState, SessionRecord, WorktreeRecord } from '../../src/state/types'

import { appReducer, createInitialState } from '../../src/state/store'

const NOW = '2026-05-23T00:00:00.000Z'

function worktree(id: string, overrides: Partial<WorktreeRecord> = {}): WorktreeRecord {
  return {
    createdAt: NOW,
    createdByAimux: false,
    id,
    name: id,
    path: `/tmp/${id}`,
    repoRoot: '/tmp/main',
    source: 'aimux-temp',
    updatedAt: NOW,
    ...overrides,
  }
}

function seed(): AppState {
  const session: SessionRecord = {
    activeWorktreeId: 'wt-a',
    createdAt: NOW,
    id: 's1',
    lastOpenedAt: NOW,
    name: 's1',
    updatedAt: NOW,
    worktrees: [
      worktree('wt-main', { name: 'main', source: 'primary' }),
      worktree('wt-a', { branch: 'feat/a' }),
      worktree('wt-b', { branch: 'feat/b' }),
    ],
  }
  // The picker is only opened from git mode.
  return { ...createInitialState({}, [session]), currentSessionId: 's1', focusMode: 'git' }
}

test('open-worktree-move-modal overlays git mode without flipping focus', () => {
  const s1 = appReducer(seed(), { type: 'open-worktree-move-modal' })
  if (s1.modal.type !== 'worktree-move') throw new Error('expected worktree-move modal')
  expect(s1.focusMode).toBe('git')
  expect(s1.modal.selectedIndex).toBe(0)
  expect(s1.modal.deleteSource).toBe(false)
})

test('closing the picker stays in git mode (overlay, never exited)', () => {
  const s1 = appReducer(seed(), { type: 'open-worktree-move-modal' })
  const s2 = appReducer(s1, { type: 'close-modal' })
  expect(s2.modal.type).toBeNull()
  expect(s2.focusMode).toBe('git')
})

test('toggle-worktree-move-delete flips deleteSource', () => {
  const s1 = appReducer(seed(), { type: 'open-worktree-move-modal' })
  const s2 = appReducer(s1, { type: 'toggle-worktree-move-delete' })
  if (s2.modal.type !== 'worktree-move') throw new Error('expected worktree-move modal')
  expect(s2.modal.deleteSource).toBe(true)
})

test('move-modal-selection navigates within the target list (worktrees minus active source)', () => {
  // 3 worktrees, active = wt-a → 2 targets (wt-main, wt-b) → optionCount 2.
  const s1 = appReducer(seed(), { type: 'open-worktree-move-modal' })
  const s2 = appReducer(s1, { delta: 1, type: 'move-modal-selection' })
  expect(s2.modal.selectedIndex).toBe(1)
  // Wraps around the 2 targets, not beyond.
  const s3 = appReducer(s2, { delta: 1, type: 'move-modal-selection' })
  expect(s3.modal.selectedIndex).toBe(0)
})
