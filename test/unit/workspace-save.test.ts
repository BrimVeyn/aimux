import { describe, expect, test } from 'bun:test'

import type { SessionRecord } from '../../src/state/types'

import { createInitialState } from '../../src/state/store'
import { buildSessionsWithCurrentSnapshot } from '../../src/state/workspace-save'

function makeSession(id: string, name: string): SessionRecord {
  const now = new Date().toISOString()
  return { createdAt: now, id, lastOpenedAt: now, name, updatedAt: now }
}

describe('buildSessionsWithCurrentSnapshot', () => {
  test('stamps current session with workspace snapshot', () => {
    const sessions = [makeSession('s1', 'one'), makeSession('s2', 'two')]
    const state = {
      ...createInitialState(),
      currentSessionId: 's1',
      sessions,
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
