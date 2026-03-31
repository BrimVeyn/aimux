import { describe, expect, test } from 'bun:test'

import type { SessionRecord } from '../../src/state/types'

import { createInitialState } from '../../src/state/store'
import { buildSessionsWithCurrentSnapshot } from '../../src/state/workspace-save'

function makeSession(id: string, name: string): SessionRecord {
  const now = new Date().toISOString()
  return { id, name, createdAt: now, updatedAt: now, lastOpenedAt: now }
}

describe('buildSessionsWithCurrentSnapshot', () => {
  test('stamps current session with workspace snapshot', () => {
    const sessions = [makeSession('s1', 'one'), makeSession('s2', 'two')]
    const state = {
      ...createInitialState(),
      sessions,
      currentSessionId: 's1',
      tabs: [
        {
          id: 'tab-1',
          assistant: 'claude' as const,
          title: 'Claude',
          status: 'running' as const,
          buffer: '',
          terminalModes: {
            mouseTrackingMode: 'none' as const,
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
          command: 'claude',
        },
      ],
    }

    const result = buildSessionsWithCurrentSnapshot(sessions, 's1', state)
    expect(result).toHaveLength(2)
    expect(result[0]?.workspaceSnapshot).toBeDefined()
    expect(result[0]?.workspaceSnapshot?.tabs).toHaveLength(1)
    expect(result[1]?.workspaceSnapshot).toBeUndefined()
  })

  test('returns sessions unchanged when no current session', () => {
    const sessions = [makeSession('s1', 'one')]
    const state = createInitialState()
    const result = buildSessionsWithCurrentSnapshot(sessions, null, state)
    expect(result).toEqual(sessions)
  })
})
