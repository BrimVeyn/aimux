import { describe, expect, test } from 'bun:test'

import { filterSessions, filterSnippets } from '../../src/state/selectors'

describe('state selectors', () => {
  test('filters sessions by name and project path', () => {
    expect(
      filterSessions(
        [
          {
            createdAt: '2024-01-01T00:00:00.000Z',
            id: 's1',
            lastOpenedAt: '2024-01-01T00:00:00.000Z',
            name: 'Main project',
            projectPath: '/tmp/alpha',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            createdAt: '2024-01-01T00:00:00.000Z',
            id: 's2',
            lastOpenedAt: '2024-01-01T00:00:00.000Z',
            name: 'Infra',
            projectPath: '/tmp/beta',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        'beta'
      )
    ).toHaveLength(1)
  })

  test('filters snippets by name and content', () => {
    expect(
      filterSnippets(
        [
          { content: 'Check for bugs', id: 'n1', name: 'Review' },
          { content: 'Step by step', id: 'n2', name: 'Explain' },
        ],
        'bugs'
      )
    ).toEqual([{ content: 'Check for bugs', id: 'n1', name: 'Review' }])
  })
})
