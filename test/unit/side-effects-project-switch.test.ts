import { expect, test } from 'bun:test'

import { executeSideEffect } from '../../src/app-runtime/side-effects'
import { appReducer, createInitialState } from '../../src/state/store'

function createSession(id: string, order: number) {
  return {
    createdAt: '2024-01-01T00:00:00.000Z',
    id,
    lastOpenedAt: '2024-01-01T00:00:00.000Z',
    name: `Project ${order}`,
    order,
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

test('switch-project-by-index exits git mode when clicking the active project', () => {
  const state = {
    ...createInitialState(),
    currentProjectId: 'project-1',
    focusMode: 'git' as const,
    projects: [createSession('project-1', 1), createSession('project-2', 2)],
  }
  const dispatched: { type: string }[] = []

  executeSideEffect(
    { index: 1, type: 'switch-project-by-index' },
    {
      activeTab: undefined,
      backend: {} as never,
      clearIdleTimer: () => {},
      clearStartupGrace: () => {},
      dispatch: (action) => {
        dispatched.push(action)
      },
      getCurrentProjectProjectPath: () => {},
      getState: () => state,
      renderer: { destroy() {} } as never,
      setThemeId: () => {},
      startStartupGrace: () => {},
      state,
      themeId: 'opencode',
    }
  )

  expect(dispatched).toEqual([{ type: 'exit-git-mode' }])
})

test('launch-selected-assistant puts the new tab in the active worktree', () => {
  const now = '2024-01-01T00:00:00.000Z'
  const project = {
    activeWorktreeId: 'wt-feature',
    createdAt: now,
    id: 'project-1',
    lastOpenedAt: now,
    name: 'Main',
    projectPath: '/repo/feature',
    updatedAt: now,
    worktrees: [
      {
        createdAt: now,
        createdByAimux: false,
        id: 'wt-main',
        name: 'main',
        path: '/repo/main',
        repoRoot: '/repo/main',
        source: 'primary' as const,
        updatedAt: now,
      },
      {
        createdAt: now,
        createdByAimux: true,
        id: 'wt-feature',
        name: 'feature',
        path: '/repo/feature',
        repoRoot: '/repo/main',
        source: 'aimux-temp' as const,
        updatedAt: now,
      },
    ],
  }
  const base = { ...createInitialState({}, [project]), currentProjectId: 'project-1' }
  const state = { ...base, modal: appReducer(base, { type: 'open-new-tab-modal' }).modal }
  const dispatched: { type: string; tab?: { worktreeId?: string } }[] = []

  executeSideEffect(
    { type: 'launch-selected-assistant' },
    {
      activeTab: undefined,
      backend: { createSession: () => {}, write: () => {} } as never,
      clearIdleTimer: () => {},
      clearStartupGrace: () => {},
      dispatch: (action) => {
        dispatched.push(action as { type: string; tab?: { worktreeId?: string } })
      },
      getCurrentProjectProjectPath: () => '/repo/feature',
      getState: () => state,
      renderer: { destroy() {} } as never,
      setThemeId: () => {},
      startStartupGrace: () => {},
      state,
      themeId: 'opencode',
    }
  )

  const added = dispatched.find((action) => action.type === 'add-tab')
  expect(added?.tab?.worktreeId).toBe('wt-feature')
})
