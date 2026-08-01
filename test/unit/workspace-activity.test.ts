import { afterEach, describe, expect, test } from 'bun:test'

import type { AppAction } from '../../src/state/actions'
import type { AppState } from '../../src/state/types'

import {
  aggregate,
  forgetTabActivity,
  recordTabStatus,
  recordTurnComplete,
  resetWorkspaceActivity,
} from '../../src/app-runtime/workspace-activity'
import { setActiveDispatch } from '../../src/state/dispatch-ref'
import { appReducer, createInitialState } from '../../src/state/store'

function collectDispatches(): AppAction[] {
  const seen: AppAction[] = []
  setActiveDispatch((action) => seen.push(action))
  return seen
}

afterEach(() => {
  setActiveDispatch(null)
  resetWorkspaceActivity()
})

describe('aggregate', () => {
  test('a waiting tab outranks working siblings, and idle says nothing', () => {
    expect(aggregate(['idle', 'idle'])).toEqual({ waiting: false, working: false })
    expect(aggregate(['idle', 'working'])).toEqual({ waiting: false, working: true })
    expect(aggregate(['working', 'waiting-input'])).toEqual({ waiting: true, working: true })
    expect(aggregate([])).toEqual({ waiting: false, working: false })
  })
})

describe('recordTabStatus', () => {
  test('publishes the aggregate of every tab in the workspace', () => {
    const seen = collectDispatches()
    recordTabStatus('t1', 'working', 'w1')
    recordTabStatus('t2', 'idle', 'w1')

    expect(seen.at(-1)).toEqual({
      type: 'set-workspace-activity',
      waiting: false,
      working: true,
      workspaceId: 'w1',
    })

    // The last working tab going idle takes the workspace with it.
    recordTabStatus('t1', 'idle', 'w1')
    expect(seen.at(-1)).toEqual({
      type: 'set-workspace-activity',
      waiting: false,
      working: false,
      workspaceId: 'w1',
    })
  })

  test('a tab moved to another workspace clears the one it left', () => {
    const seen = collectDispatches()
    recordTabStatus('t1', 'working', 'w1')
    seen.length = 0
    recordTabStatus('t1', 'working', 'w2')

    expect(seen).toContainEqual({
      type: 'set-workspace-activity',
      waiting: false,
      working: false,
      workspaceId: 'w1',
    })
    expect(seen).toContainEqual({
      type: 'set-workspace-activity',
      waiting: false,
      working: true,
      workspaceId: 'w2',
    })
  })

  test('a tab with no workspace still tracks, it just has nowhere to publish', () => {
    const seen = collectDispatches()
    recordTabStatus('t1', 'waiting-input', undefined)
    expect(seen).toEqual([])
  })

  test('forgetting a tab republishes what is left', () => {
    const seen = collectDispatches()
    recordTabStatus('t1', 'waiting-input', 'w1')
    seen.length = 0
    forgetTabActivity('t1')

    expect(seen.at(-1)).toEqual({
      type: 'set-workspace-activity',
      waiting: false,
      working: false,
      workspaceId: 'w1',
    })
  })
})

describe('recordTurnComplete', () => {
  test('latches the workspace as finished-unseen', () => {
    const seen = collectDispatches()
    recordTurnComplete('t1', 'w1')
    expect(seen).toEqual([{ type: 'mark-workspace-done', workspaceId: 'w1' }])
  })
})

describe('the workspaceActivity reducer', () => {
  function reduce(state: AppState, ...actions: AppAction[]): AppState {
    let next = state
    for (const action of actions) next = appReducer(next, action)
    return next
  }

  test('going back to work clears the finished-unseen tick', () => {
    const done = reduce(createInitialState(), { type: 'mark-workspace-done', workspaceId: 'w1' })
    expect(done.workspaceActivity.w1).toEqual({ done: true, waiting: false, working: false })

    const busy = reduce(done, {
      type: 'set-workspace-activity',
      waiting: false,
      working: true,
      workspaceId: 'w1',
    })
    expect(busy.workspaceActivity.w1).toEqual({ done: false, waiting: false, working: true })
  })

  test('an idle update leaves the tick alone', () => {
    const done = reduce(createInitialState(), { type: 'mark-workspace-done', workspaceId: 'w1' })
    const still = reduce(done, {
      type: 'set-workspace-activity',
      waiting: false,
      working: false,
      workspaceId: 'w1',
    })
    expect(still.workspaceActivity.w1?.done).toBe(true)
    // Nothing changed, so the state identity must not either — every sidebar row
    // subscribes to this map.
    expect(still).toBe(done)
  })

  test('entering the workspace clears the tick', () => {
    const now = '2026-08-01T00:00:00.000Z'
    const base: AppState = {
      ...createInitialState(),
      currentProjectId: 'p1',
      projects: [
        {
          createdAt: now,
          id: 'p1',
          lastOpenedAt: now,
          name: 'one',
          updatedAt: now,
          workspaces: [
            {
              createdAt: now,
              createdByAimux: false,
              id: 'w1',
              name: 'one',
              path: '/tmp/one',
              repoRoot: '/tmp/one',
              source: 'primary',
              updatedAt: now,
            },
          ],
        },
      ],
    }
    const done = reduce(base, { type: 'mark-workspace-done', workspaceId: 'w1' })
    const visited = reduce(done, {
      projectId: 'p1',
      type: 'set-active-workspace',
      workspaceId: 'w1',
    })
    expect(visited.workspaceActivity.w1?.done).toBe(false)
  })
})
