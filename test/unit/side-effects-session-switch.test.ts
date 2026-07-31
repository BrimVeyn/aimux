import { expect, test } from 'bun:test'

import { executeSideEffect } from '../../src/app-runtime/side-effects'
import { appReducer, createInitialState } from '../../src/state/store'

function createSession(id: string, order: number) {
  return {
    createdAt: '2024-01-01T00:00:00.000Z',
    id,
    lastOpenedAt: '2024-01-01T00:00:00.000Z',
    name: `Session ${order}`,
    order,
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

test('switch-session-by-index exits git mode when clicking the active session', () => {
  const state = {
    ...createInitialState(),
    currentSessionId: 'session-1',
    focusMode: 'git' as const,
    sessions: [createSession('session-1', 1), createSession('session-2', 2)],
  }
  const dispatched: { type: string }[] = []

  executeSideEffect(
    { index: 1, type: 'switch-session-by-index' },
    {
      activeTab: undefined,
      backend: {} as never,
      clearIdleTimer: () => {},
      clearStartupGrace: () => {},
      dispatch: (action) => {
        dispatched.push(action)
      },
      getCurrentSessionProjectPath: () => {},
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
  const session = {
    activeWorktreeId: 'wt-feature',
    createdAt: now,
    id: 'session-1',
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
  const base = { ...createInitialState({}, [session]), currentSessionId: 'session-1' }
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
      getCurrentSessionProjectPath: () => '/repo/feature',
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
