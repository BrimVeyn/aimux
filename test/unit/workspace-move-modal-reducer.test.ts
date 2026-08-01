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
      workspace('wt-main', { name: 'main', source: 'primary' }),
      workspace('wt-a', { branch: 'feat/a' }),
      workspace('wt-b', { branch: 'feat/b' }),
    ],
  }
  // The picker is only opened from git mode.
  return { ...createInitialState({}, [project]), currentProjectId: 's1', focusMode: 'git' }
}

test('open-workspace-move-modal overlays git mode without flipping focus', () => {
  const s1 = appReducer(seed(), { sourceWorkspaceId: 'wt-a', type: 'open-workspace-move-modal' })
  if (s1.modal.type !== 'workspace-move') throw new Error('expected workspace-move modal')
  expect(s1.focusMode).toBe('git')
  expect(s1.modal.sourceWorkspaceId).toBe('wt-a')
  expect(s1.modal.selectedIndex).toBe(0)
  expect(s1.modal.deleteSource).toBe(false)
})

test('opening from a tab menu (navigation) stays in the normal view, not git mode', () => {
  const base = { ...seed(), focusMode: 'navigation' as const }
  const s1 = appReducer(base, { sourceWorkspaceId: 'wt-b', type: 'open-workspace-move-modal' })
  if (s1.modal.type !== 'workspace-move') throw new Error('expected workspace-move modal')
  expect(s1.focusMode).toBe('navigation')
  expect(s1.modal.sourceWorkspaceId).toBe('wt-b')
})

test('closing the picker stays in git mode (overlay, never exited)', () => {
  const s1 = appReducer(seed(), { sourceWorkspaceId: 'wt-a', type: 'open-workspace-move-modal' })
  const s2 = appReducer(s1, { type: 'close-modal' })
  expect(s2.modal.type).toBeNull()
  expect(s2.focusMode).toBe('git')
})

test('toggle-workspace-move-delete flips deleteSource', () => {
  const s1 = appReducer(seed(), { sourceWorkspaceId: 'wt-a', type: 'open-workspace-move-modal' })
  const s2 = appReducer(s1, { type: 'toggle-workspace-move-delete' })
  if (s2.modal.type !== 'workspace-move') throw new Error('expected workspace-move modal')
  expect(s2.modal.deleteSource).toBe(true)
})

test('move-modal-selection navigates within the target list (workspaces minus active source)', () => {
  // 3 workspaces, active = wt-a → 2 targets (wt-main, wt-b) → optionCount 2.
  const s1 = appReducer(seed(), { sourceWorkspaceId: 'wt-a', type: 'open-workspace-move-modal' })
  const s2 = appReducer(s1, { delta: 1, type: 'move-modal-selection' })
  expect(s2.modal.selectedIndex).toBe(1)
  // Wraps around the 2 targets, not beyond.
  const s3 = appReducer(s2, { delta: 1, type: 'move-modal-selection' })
  expect(s3.modal.selectedIndex).toBe(0)
})

test('stats start loading and are filled by set-workspace-move-stats', () => {
  const s1 = appReducer(seed(), { sourceWorkspaceId: 'wt-a', type: 'open-workspace-move-modal' })
  if (s1.modal.type !== 'workspace-move') throw new Error('expected workspace-move modal')
  expect(s1.modal.stats).toEqual({ kind: 'loading' })
  const s2 = appReducer(s1, {
    dirtyFiles: { 'wt-a': 2, 'wt-b': 0 },
    type: 'set-workspace-move-stats',
  })
  if (s2.modal.type !== 'workspace-move') throw new Error('expected workspace-move modal')
  expect(s2.modal.stats).toEqual({ dirtyFiles: { 'wt-a': 2, 'wt-b': 0 }, kind: 'ready' })
})

test('set-workspace-move-stats is ignored when another modal is open', () => {
  const base = seed()
  const s1 = appReducer(base, { dirtyFiles: { 'wt-a': 1 }, type: 'set-workspace-move-stats' })
  expect(s1).toBe(base)
})

const CONFIRM_FIELDS = {
  deleteSource: true,
  files: ['file.txt'],
  projectId: 's1',
  sourceLabel: 'feat/a',
  sourceWorkspaceId: 'wt-a',
  targetLabel: 'feat/b',
  targetWorkspaceId: 'wt-b',
}

test('open-workspace-move-confirm takes modal focus and carries the retry params', () => {
  const s1 = appReducer(seed(), {
    ...CONFIRM_FIELDS,
    type: 'open-workspace-move-confirm',
    variant: 'stash-target',
  })
  if (s1.modal.type !== 'workspace-move-confirm') throw new Error('expected confirm modal')
  expect(s1.focusMode).toBe('modal')
  expect(s1.modal.variant).toBe('stash-target')
  expect(s1.modal.files).toEqual(['file.txt'])
  expect(s1.modal.deleteSource).toBe(true)
  expect(s1.modal.sourceWorkspaceId).toBe('wt-a')
  expect(s1.modal.targetWorkspaceId).toBe('wt-b')
})

test('closing the confirm modal lands on navigation', () => {
  const s1 = appReducer(seed(), {
    ...CONFIRM_FIELDS,
    type: 'open-workspace-move-confirm',
    variant: 'keep-conflicts',
  })
  const s2 = appReducer(s1, { type: 'close-modal' })
  expect(s2.modal.type).toBeNull()
  expect(s2.focusMode).toBe('navigation')
})
