import { expect, test } from 'bun:test'

import { executeSideEffect } from '../../src/app-runtime/side-effects'
import { createInitialState } from '../../src/state/store'

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
