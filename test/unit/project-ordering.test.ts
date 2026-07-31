import { describe, expect, test } from 'bun:test'

import type { ProjectRecord } from '../../src/state/types'

import { orderProjectsForDisplay } from '../../src/ui/project-ordering'

function makeProject(id: string, createdAt: string, order?: number): ProjectRecord {
  return {
    createdAt,
    id,
    lastOpenedAt: createdAt,
    name: id,
    order,
    updatedAt: createdAt,
  }
}

describe('orderProjectsForDisplay', () => {
  test('sorts by order ascending when all have order', () => {
    const projects = [
      makeProject('b', '2024-02-01T00:00:00Z', 1),
      makeProject('a', '2024-01-01T00:00:00Z', 0),
      makeProject('c', '2024-03-01T00:00:00Z', 2),
    ]
    expect(orderProjectsForDisplay(projects).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  test('projects missing order fall back to createdAt ascending, placed after ordered ones', () => {
    const projects = [
      makeProject('old-noorder', '2023-01-01T00:00:00Z'),
      makeProject('new-noorder', '2024-06-01T00:00:00Z'),
      makeProject('has-order', '2024-01-01T00:00:00Z', 0),
    ]
    expect(orderProjectsForDisplay(projects).map((s) => s.id)).toEqual([
      'has-order',
      'old-noorder',
      'new-noorder',
    ])
  })

  test('does not mutate input', () => {
    const projects = [
      makeProject('b', '2024-02-01T00:00:00Z', 1),
      makeProject('a', '2024-01-01T00:00:00Z', 0),
    ]
    const copy = [...projects]
    orderProjectsForDisplay(projects)
    expect(projects).toEqual(copy)
  })
})
