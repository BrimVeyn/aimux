import { describe, expect, test } from 'bun:test'

import type { ProjectRecord } from '../../src/state/types'

import { createInitialState } from '../../src/state/store'
import { buildProjectsWithCurrentSnapshot } from '../../src/state/workspace-save'

function makeProject(id: string, name: string): ProjectRecord {
  const now = new Date().toISOString()
  return { createdAt: now, id, lastOpenedAt: now, name, updatedAt: now }
}

describe('buildProjectsWithCurrentSnapshot', () => {
  test('stamps current project with workspace snapshot', () => {
    const projects = [makeProject('s1', 'one'), makeProject('s2', 'two')]
    const state = {
      ...createInitialState(),
      currentProjectId: 's1',
      projects,
      tabs: [
        {
          assistant: 'claude' as const,
          buffer: '',
          command: 'claude',
          id: 'tab-1',
          status: 'running' as const,
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'none' as const,
            sendFocusMode: false,
          },
          title: 'Claude',
        },
      ],
    }

    const result = buildProjectsWithCurrentSnapshot(projects, 's1', state)
    expect(result).toHaveLength(2)
    expect(result[0]?.workspaceSnapshot).toBeDefined()
    expect(result[0]?.workspaceSnapshot?.tabs).toHaveLength(1)
    expect(result[1]?.workspaceSnapshot).toBeUndefined()
  })

  test('returns projects unchanged when no current project', () => {
    const projects = [makeProject('s1', 'one')]
    const state = createInitialState()
    const result = buildProjectsWithCurrentSnapshot(projects, null, state)
    expect(result).toEqual(projects)
  })
})
