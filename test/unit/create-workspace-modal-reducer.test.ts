import { expect, test } from 'bun:test'

import type { AppState, ProjectRecord, WorkspaceRecord } from '../../src/state/types'

import { appReducer, createInitialState } from '../../src/state/store'

const NOW = '2026-05-23T00:00:00.000Z'

function workspace(id: string, overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
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
  const project: ProjectRecord = {
    activeWorkspaceId: 'wt-a',
    createdAt: NOW,
    id: 's1',
    lastOpenedAt: NOW,
    name: 's1',
    updatedAt: NOW,
    workspaces: [
      workspace('wt-main', { branch: 'main', name: 'main', source: 'primary' }),
      workspace('wt-a', { branch: 'feat/a' }),
    ],
  }
  return { ...createInitialState({}, [project]), currentProjectId: 's1' }
}

function open(state: AppState = seed()): AppState {
  return appReducer(state, { type: 'open-create-workspace-modal' })
}

function type(state: AppState, text: string): AppState {
  let next = state
  for (const char of text) {
    next = appReducer(next, { char, type: 'update-command-edit' })
  }
  return next
}

test('open-create-workspace-modal defaults the base to the active workspace branch', () => {
  const s = open()
  if (s.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s.focusMode).toBe('command-edit')
  expect(s.modal.step).toBe('form')
  expect(s.modal.activeField).toBe('name')
  expect(s.modal.baseRef).toBe('feat/a')
  expect(s.modal.workspaceName).toBe('')
})

test('Tab cycles name -> branch -> base -> name and moves the cursor to the field end', () => {
  const s1 = type(open(), 'my-feature')
  if (s1.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s1.modal.workspaceName).toBe('my-feature')

  const s2 = appReducer(s1, { type: 'switch-create-workspace-field' })
  if (s2.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s2.modal.activeField).toBe('branch')
  expect(s2.modal.cursorPos).toBe(0)

  const s3 = appReducer(type(s2, 'aimux/x'), { type: 'switch-create-workspace-field' })
  if (s3.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s3.modal.activeField).toBe('base')

  const s4 = appReducer(s3, { type: 'switch-create-workspace-field' })
  if (s4.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s4.modal.activeField).toBe('name')
  // Back on the name field the cursor sits after the text already typed.
  expect(s4.modal.cursorPos).toBe('my-feature'.length)
  expect(s4.modal.branchName).toBe('aimux/x')
})

test('typing in the branch field clears a previous branch error', () => {
  const s1 = appReducer(open(), { message: 'taken', type: 'set-create-workspace-branch-error' })
  if (s1.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s1.modal.activeField).toBe('branch')
  expect(s1.modal.branchError).toBe('taken')

  const s2 = type(s1, 'z')
  if (s2.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s2.modal.branchError).toBeNull()
  expect(s2.modal.branchName).toBe('z')
})

test('set-create-workspace-base-branches backfills the base only when unresolved', () => {
  const kept = appReducer(open(), {
    branches: ['develop', 'main'],
    type: 'set-create-workspace-base-branches',
  })
  if (kept.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(kept.modal.baseRef).toBe('feat/a')

  // A project whose active workspace has no branch (detached) starts unresolved.
  const detached = seed()
  const project = detached.projects[0]
  if (!project) throw new Error('expected a seeded project')
  const noBranch: AppState = {
    ...detached,
    projects: [{ ...project, workspaces: [workspace('wt-a', { branch: undefined })] }],
  }
  const filled = appReducer(open(noBranch), {
    branches: ['develop'],
    type: 'set-create-workspace-base-branches',
  })
  if (filled.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(filled.modal.baseRef).toBe('develop')
})

test('set-create-workspace-step round-trips form <-> template and lands back on the name field', () => {
  const s1 = appReducer(type(open(), 'wt'), { step: 'template', type: 'set-create-workspace-step' })
  if (s1.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s1.modal.step).toBe('template')
  expect(s1.modal.selectedIndex).toBe(0)

  const s2 = appReducer(s1, { step: 'form', type: 'set-create-workspace-step' })
  if (s2.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s2.modal.step).toBe('form')
  expect(s2.modal.activeField).toBe('name')
  // The typed name survives the round trip — Esc from the template step must
  // not discard the form.
  expect(s2.modal.workspaceName).toBe('wt')
  expect(s2.modal.cursorPos).toBe(2)
})

test('the template step swallows typed characters instead of editing a field', () => {
  const s1 = appReducer(type(open(), 'wt'), { step: 'template', type: 'set-create-workspace-step' })
  const s2 = type(s1, 'xyz')
  if (s2.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s2.modal.workspaceName).toBe('wt')
})
