import { describe, expect, test } from 'bun:test'

import type { SessionRecord } from '../../src/state/types'

import { appReducer, createInitialState } from '../../src/state/store'

function makeSession(id: string, order: number, createdAt = '2024-01-01T00:00:00Z'): SessionRecord {
  return {
    createdAt,
    id,
    lastOpenedAt: createdAt,
    name: `session-${id}`,
    order,
    updatedAt: createdAt,
  }
}

describe('session bar reducer', () => {
  test('toggle-session-bar flips visible', () => {
    const s0 = createInitialState({}, [], [], false)
    expect(s0.sessionBar.visible).toBe(true)
    const s1 = appReducer(s0, { type: 'toggle-session-bar' })
    expect(s1.sessionBar.visible).toBe(false)
    const s2 = appReducer(s1, { type: 'toggle-session-bar' })
    expect(s2.sessionBar.visible).toBe(true)
  })

  test('set-session-bar-position updates position only when changed', () => {
    const s0 = createInitialState({}, [], [], false)
    expect(s0.sessionBar.position).toBe('top')
    const s1 = appReducer(s0, { position: 'bottom', type: 'set-session-bar-position' })
    expect(s1.sessionBar.position).toBe('bottom')
    const s2 = appReducer(s1, { position: 'bottom', type: 'set-session-bar-position' })
    expect(s2).toBe(s1)
  })

  test('set-session-status records a per-session status', () => {
    const s0 = createInitialState({}, [], [], false)
    const s1 = appReducer(s0, { sessionId: 'a', status: 'working', type: 'set-session-status' })
    expect(s1.sessionStatuses.a).toBe('working')
    const s2 = appReducer(s1, { sessionId: 'a', status: 'idle', type: 'set-session-status' })
    expect(s2.sessionStatuses.a).toBe('idle')
    // no-op when unchanged
    const s3 = appReducer(s2, { sessionId: 'a', status: 'idle', type: 'set-session-status' })
    expect(s3).toBe(s2)
  })

  test('reorder-sessions rewrites order fields', () => {
    const sessions = [makeSession('a', 0), makeSession('b', 1), makeSession('c', 2)]
    const s0 = createInitialState({}, sessions, [], false)
    const s1 = appReducer(s0, { orderedIds: ['c', 'a', 'b'], type: 'reorder-sessions' })
    expect(s1.sessions.map((s) => s.id)).toEqual(['c', 'a', 'b'])
    expect(s1.sessions.map((s) => s.order)).toEqual([0, 1, 2])
  })

  test('reorder-sessions appends unmentioned sessions at end', () => {
    const sessions = [makeSession('a', 0), makeSession('b', 1), makeSession('c', 2)]
    const s0 = createInitialState({}, sessions, [], false)
    const s1 = appReducer(s0, { orderedIds: ['b'], type: 'reorder-sessions' })
    const ids = s1.sessions.map((s) => s.id)
    expect(ids[0]).toBe('b')
    expect(ids).toContain('a')
    expect(ids).toContain('c')
    // Orders are a stable 0..n-1 sequence
    expect(s1.sessions.map((s) => s.order)).toEqual([0, 1, 2])
  })
})
