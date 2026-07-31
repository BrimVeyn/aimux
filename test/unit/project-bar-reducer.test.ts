import { describe, expect, test } from 'bun:test'

import type { ProjectRecord } from '../../src/state/types'

import { appReducer, createInitialState } from '../../src/state/store'

function makeProject(id: string, order: number, createdAt = '2024-01-01T00:00:00Z'): ProjectRecord {
  return {
    createdAt,
    id,
    lastOpenedAt: createdAt,
    name: `project-${id}`,
    order,
    updatedAt: createdAt,
  }
}

describe('project bar reducer', () => {
  test('toggle-project-bar flips visible', () => {
    const s0 = createInitialState({}, [], [], false)
    expect(s0.projectBar.visible).toBe(true)
    const s1 = appReducer(s0, { type: 'toggle-project-bar' })
    expect(s1.projectBar.visible).toBe(false)
    const s2 = appReducer(s1, { type: 'toggle-project-bar' })
    expect(s2.projectBar.visible).toBe(true)
  })

  test('set-project-status records per-project working/waiting flags', () => {
    const s0 = createInitialState({}, [], [], false)
    const working = { waiting: false, working: true }
    const both = { waiting: true, working: true }
    const idle = { waiting: false, working: false }

    const s1 = appReducer(s0, { projectId: 'a', status: working, type: 'set-project-status' })
    expect(s1.projectStatuses.a).toEqual(working)

    const s2 = appReducer(s1, { projectId: 'a', status: both, type: 'set-project-status' })
    expect(s2.projectStatuses.a).toEqual(both)

    const s3 = appReducer(s2, { projectId: 'a', status: idle, type: 'set-project-status' })
    expect(s3.projectStatuses.a).toEqual(idle)

    // no-op when unchanged
    const s4 = appReducer(s3, { projectId: 'a', status: idle, type: 'set-project-status' })
    expect(s4).toBe(s3)
  })

  test('reorder-projects rewrites order fields', () => {
    const projects = [makeProject('a', 0), makeProject('b', 1), makeProject('c', 2)]
    const s0 = createInitialState({}, projects, [], false)
    const s1 = appReducer(s0, { orderedIds: ['c', 'a', 'b'], type: 'reorder-projects' })
    expect(s1.projects.map((s) => s.id)).toEqual(['c', 'a', 'b'])
    expect(s1.projects.map((s) => s.order)).toEqual([0, 1, 2])
  })

  test('reorder-projects appends unmentioned projects at end', () => {
    const projects = [makeProject('a', 0), makeProject('b', 1), makeProject('c', 2)]
    const s0 = createInitialState({}, projects, [], false)
    const s1 = appReducer(s0, { orderedIds: ['b'], type: 'reorder-projects' })
    const ids = s1.projects.map((s) => s.id)
    expect(ids[0]).toBe('b')
    expect(ids).toContain('a')
    expect(ids).toContain('c')
    // Orders are a stable 0..n-1 sequence
    expect(s1.projects.map((s) => s.order)).toEqual([0, 1, 2])
  })

  describe('reorder-active-project', () => {
    const projects = () => [makeProject('a', 0), makeProject('b', 1), makeProject('c', 2)]
    const withCurrent = (id: string) => ({
      ...createInitialState({}, projects(), [], false),
      currentProjectId: id,
    })

    test('moves current project down by one', () => {
      const s0 = withCurrent('b')
      const s1 = appReducer(s0, { delta: 1, type: 'reorder-active-project' })
      expect(s1.projects.map((s) => s.id)).toEqual(['a', 'c', 'b'])
      expect(s1.projects.map((s) => s.order)).toEqual([0, 1, 2])
    })

    test('moves current project up by one', () => {
      const s0 = withCurrent('b')
      const s1 = appReducer(s0, { delta: -1, type: 'reorder-active-project' })
      expect(s1.projects.map((s) => s.id)).toEqual(['b', 'a', 'c'])
      expect(s1.projects.map((s) => s.order)).toEqual([0, 1, 2])
    })

    test('no-op at top edge', () => {
      const s0 = withCurrent('a')
      const s1 = appReducer(s0, { delta: -1, type: 'reorder-active-project' })
      expect(s1).toBe(s0)
    })

    test('no-op at bottom edge', () => {
      const s0 = withCurrent('c')
      const s1 = appReducer(s0, { delta: 1, type: 'reorder-active-project' })
      expect(s1).toBe(s0)
    })

    test('no-op when no current project', () => {
      const s0 = createInitialState({}, projects(), [], false)
      const s1 = appReducer(s0, { delta: 1, type: 'reorder-active-project' })
      expect(s1).toBe(s0)
    })
  })
})
