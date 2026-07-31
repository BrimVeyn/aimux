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

test('open-create-workspace-modal opens on an empty prompt with no base resolved yet', () => {
  const s = open()
  if (s.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s.focusMode).toBe('command-edit')
  expect(s.modal.step).toBe('form')
  expect(s.modal.activeField).toBe('prompt')
  expect(s.modal.prompt).toBe('')
  // Left for the async default-branch lookup to fill; seeding the active
  // workspace's branch here would beat it to the field.
  expect(s.modal.baseRef).toBe('')
})

test('Tab cycles prompt -> base -> prompt and moves the cursor to the field end', () => {
  const s1 = type(open(), 'fix the scroll drift')
  if (s1.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s1.modal.prompt).toBe('fix the scroll drift')

  const s2 = appReducer(s1, { type: 'switch-create-workspace-field' })
  if (s2.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s2.modal.activeField).toBe('base')
  expect(s2.modal.cursorPos).toBe(0)

  const s3 = appReducer(s2, { type: 'switch-create-workspace-field' })
  if (s3.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s3.modal.activeField).toBe('prompt')
  // Back on the prompt the cursor sits after the text already typed.
  expect(s3.modal.cursorPos).toBe('fix the scroll drift'.length)
})

test('a branch error focuses the prompt, and typing there clears it', () => {
  const s1 = appReducer(open(), { message: 'taken', type: 'set-create-workspace-branch-error' })
  if (s1.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  // There is no branch field any more, so the error has to land on the field
  // that produced the branch name.
  expect(s1.modal.activeField).toBe('prompt')
  expect(s1.modal.branchError).toBe('taken')

  const s2 = type(s1, 'z')
  if (s2.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s2.modal.branchError).toBeNull()
  expect(s2.modal.prompt).toBe('z')
})

test('set-create-workspace-base-branches forks from the repo default branch', () => {
  const s = appReducer(open(), {
    branches: ['develop', 'main'],
    defaultBranch: 'main',
    type: 'set-create-workspace-base-branches',
  })
  if (s.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s.modal.baseRef).toBe('main')
})

test('set-create-workspace-base-branches falls back when there is no default branch', () => {
  // No origin/HEAD and no main/master: the first option (most recently
  // committed) is still a better answer than an empty base.
  const base = seed()
  const project = base.projects[0]
  if (!project) throw new Error('expected a seeded project')
  const noMain: AppState = {
    ...base,
    projects: [{ ...project, workspaces: [workspace('wt-a', { branch: undefined })] }],
  }
  const s = appReducer(open(noMain), {
    branches: ['develop'],
    type: 'set-create-workspace-base-branches',
  })
  if (s.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s.modal.baseRef).toBe('develop')
})

test('set-create-workspace-base-branches leaves a base the user already chose', () => {
  const chosen = appReducer(open(), { index: 0, type: 'set-modal-selection-index' })
  const typed = appReducer(chosen, { type: 'switch-create-workspace-field' })
  if (typed.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  const withBase: AppState = { ...typed, modal: { ...typed.modal, baseRef: 'develop' } }
  const s = appReducer(withBase, {
    branches: ['develop', 'main'],
    defaultBranch: 'main',
    type: 'set-create-workspace-base-branches',
  })
  if (s.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s.modal.baseRef).toBe('develop')
})

test('set-create-workspace-step round-trips form <-> template and lands back on the prompt', () => {
  const s1 = appReducer(type(open(), 'wt'), { step: 'template', type: 'set-create-workspace-step' })
  if (s1.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s1.modal.step).toBe('template')
  expect(s1.modal.selectedIndex).toBe(0)

  const s2 = appReducer(s1, { step: 'form', type: 'set-create-workspace-step' })
  if (s2.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s2.modal.step).toBe('form')
  expect(s2.modal.activeField).toBe('prompt')
  // The typed prompt survives the round trip — Esc from the template step must
  // not discard the form.
  expect(s2.modal.prompt).toBe('wt')
  expect(s2.modal.cursorPos).toBe(2)
})

test('the template step swallows typed characters instead of editing a field', () => {
  const s1 = appReducer(type(open(), 'wt'), { step: 'template', type: 'set-create-workspace-step' })
  const s2 = type(s1, 'xyz')
  if (s2.modal.type !== 'create-workspace') throw new Error('expected create-workspace modal')
  expect(s2.modal.prompt).toBe('wt')
})
