import { describe, expect, test } from 'bun:test'

import type { SessionRecord } from '../../src/state/types'

import { orderSessionsForDisplay } from '../../src/ui/session-ordering'

function makeSession(id: string, createdAt: string, order?: number): SessionRecord {
  return {
    createdAt,
    id,
    lastOpenedAt: createdAt,
    name: id,
    order,
    updatedAt: createdAt,
  }
}

describe('orderSessionsForDisplay', () => {
  test('sorts by order ascending when all have order', () => {
    const sessions = [
      makeSession('b', '2024-02-01T00:00:00Z', 1),
      makeSession('a', '2024-01-01T00:00:00Z', 0),
      makeSession('c', '2024-03-01T00:00:00Z', 2),
    ]
    expect(orderSessionsForDisplay(sessions).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  test('sessions missing order fall back to createdAt ascending, placed after ordered ones', () => {
    const sessions = [
      makeSession('old-noorder', '2023-01-01T00:00:00Z'),
      makeSession('new-noorder', '2024-06-01T00:00:00Z'),
      makeSession('has-order', '2024-01-01T00:00:00Z', 0),
    ]
    expect(orderSessionsForDisplay(sessions).map((s) => s.id)).toEqual([
      'has-order',
      'old-noorder',
      'new-noorder',
    ])
  })

  test('does not mutate input', () => {
    const sessions = [
      makeSession('b', '2024-02-01T00:00:00Z', 1),
      makeSession('a', '2024-01-01T00:00:00Z', 0),
    ]
    const copy = [...sessions]
    orderSessionsForDisplay(sessions)
    expect(sessions).toEqual(copy)
  })
})
