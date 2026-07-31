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
      worktree('wt-main', { branch: 'main', name: 'main', source: 'primary' }),
      worktree('wt-a', { branch: 'feat/a' }),
    ],
  }
  return { ...createInitialState({}, [session]), currentSessionId: 's1' }
}

function open(state: AppState = seed()): AppState {
  return appReducer(state, { type: 'open-create-worktree-modal' })
}

function type(state: AppState, text: string): AppState {
  let next = state
  for (const char of text) {
    next = appReducer(next, { char, type: 'update-command-edit' })
  }
  return next
}

test('open-create-worktree-modal defaults the base to the active worktree branch', () => {
  const s = open()
  if (s.modal.type !== 'create-worktree') throw new Error('expected create-worktree modal')
  expect(s.focusMode).toBe('command-edit')
  expect(s.modal.step).toBe('form')
  expect(s.modal.activeField).toBe('name')
  expect(s.modal.baseRef).toBe('feat/a')
  expect(s.modal.worktreeName).toBe('')
})

test('Tab cycles name -> branch -> base -> name and moves the cursor to the field end', () => {
  const s1 = type(open(), 'my-feature')
  if (s1.modal.type !== 'create-worktree') throw new Error('expected create-worktree modal')
  expect(s1.modal.worktreeName).toBe('my-feature')

  const s2 = appReducer(s1, { type: 'switch-create-worktree-field' })
  if (s2.modal.type !== 'create-worktree') throw new Error('expected create-worktree modal')
  expect(s2.modal.activeField).toBe('branch')
  expect(s2.modal.cursorPos).toBe(0)

  const s3 = appReducer(type(s2, 'aimux/x'), { type: 'switch-create-worktree-field' })
  if (s3.modal.type !== 'create-worktree') throw new Error('expected create-worktree modal')
  expect(s3.modal.activeField).toBe('base')

  const s4 = appReducer(s3, { type: 'switch-create-worktree-field' })
  if (s4.modal.type !== 'create-worktree') throw new Error('expected create-worktree modal')
  expect(s4.modal.activeField).toBe('name')
  // Back on the name field the cursor sits after the text already typed.
  expect(s4.modal.cursorPos).toBe('my-feature'.length)
  expect(s4.modal.branchName).toBe('aimux/x')
})

test('typing in the branch field clears a previous branch error', () => {
  const s1 = appReducer(open(), { message: 'taken', type: 'set-create-worktree-branch-error' })
  if (s1.modal.type !== 'create-worktree') throw new Error('expected create-worktree modal')
  expect(s1.modal.activeField).toBe('branch')
  expect(s1.modal.branchError).toBe('taken')

  const s2 = type(s1, 'z')
  if (s2.modal.type !== 'create-worktree') throw new Error('expected create-worktree modal')
  expect(s2.modal.branchError).toBeNull()
  expect(s2.modal.branchName).toBe('z')
})

test('set-create-worktree-base-branches backfills the base only when unresolved', () => {
  const kept = appReducer(open(), {
    branches: ['develop', 'main'],
    type: 'set-create-worktree-base-branches',
  })
  if (kept.modal.type !== 'create-worktree') throw new Error('expected create-worktree modal')
  expect(kept.modal.baseRef).toBe('feat/a')

  // A session whose active worktree has no branch (detached) starts unresolved.
  const detached = seed()
  const session = detached.sessions[0]
  if (!session) throw new Error('expected a seeded session')
  const noBranch: AppState = {
    ...detached,
    sessions: [{ ...session, worktrees: [worktree('wt-a', { branch: undefined })] }],
  }
  const filled = appReducer(open(noBranch), {
    branches: ['develop'],
    type: 'set-create-worktree-base-branches',
  })
  if (filled.modal.type !== 'create-worktree') throw new Error('expected create-worktree modal')
  expect(filled.modal.baseRef).toBe('develop')
})

test('set-create-worktree-step round-trips form <-> template and lands back on the name field', () => {
  const s1 = appReducer(type(open(), 'wt'), { step: 'template', type: 'set-create-worktree-step' })
  if (s1.modal.type !== 'create-worktree') throw new Error('expected create-worktree modal')
  expect(s1.modal.step).toBe('template')
  expect(s1.modal.selectedIndex).toBe(0)

  const s2 = appReducer(s1, { step: 'form', type: 'set-create-worktree-step' })
  if (s2.modal.type !== 'create-worktree') throw new Error('expected create-worktree modal')
  expect(s2.modal.step).toBe('form')
  expect(s2.modal.activeField).toBe('name')
  // The typed name survives the round trip — Esc from the template step must
  // not discard the form.
  expect(s2.modal.worktreeName).toBe('wt')
  expect(s2.modal.cursorPos).toBe(2)
})

test('the template step swallows typed characters instead of editing a field', () => {
  const s1 = appReducer(type(open(), 'wt'), { step: 'template', type: 'set-create-worktree-step' })
  const s2 = type(s1, 'xyz')
  if (s2.modal.type !== 'create-worktree') throw new Error('expected create-worktree modal')
  expect(s2.modal.worktreeName).toBe('wt')
})
