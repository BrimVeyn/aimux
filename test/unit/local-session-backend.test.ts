import { describe, expect, mock, test } from 'bun:test'

import type { TabSession, WorkspaceSnapshotV1 } from '../../src/state/types'

import { LocalSessionBackend } from '../../src/session-backend/local-session-backend'

function createSnapshot(): WorkspaceSnapshotV1 {
  return {
    activeTabId: 'tab-a',
    savedAt: new Date().toISOString(),
    sidebar: { visible: true, width: 28 },
    tabs: [
      {
        assistant: 'claude',
        buffer: '',
        command: 'claude',
        id: 'tab-a',
        status: 'running',
        terminalModes: {
          alternateScrollMode: false,
          bracketedPasteMode: false,
          isAlternateBuffer: false,
          mouseTrackingMode: 'none',
          sendFocusMode: false,
        },
        title: 'Alpha',
      },
    ],
    version: 1,
  }
}

describe('LocalSessionBackend.attach', () => {
  test('resizes the full session during attach without threading scroll intents', async () => {
    const backend = new LocalSessionBackend()
    const backendInternal = backend as unknown as {
      sessionManager: {
        attachSession: ReturnType<typeof mock>
        listTabs: ReturnType<typeof mock>
        resize: ReturnType<typeof mock>
        resizeTab: ReturnType<typeof mock>
      }
      statusLoop: {
        classifyNow: ReturnType<typeof mock>
        getTabStatus: ReturnType<typeof mock>
        snapshotSessions: ReturnType<typeof mock>
      }
    }

    const snapshot = createSnapshot()
    const attachTabs = snapshot.tabs as unknown as TabSession[]
    backendInternal.sessionManager = {
      attachSession: mock(() => ({ activeTabId: 'tab-a', tabs: attachTabs })),
      listTabs: mock(() => attachTabs),
      resize: mock(() => {}),
      resizeTab: mock(() => {}),
    }
    backendInternal.statusLoop = {
      classifyNow: mock(() => {}),
      getTabStatus: mock(() => undefined),
      snapshotSessions: mock(() => []),
    }

    await backend.attach({
      cols: 80,
      rows: 24,
      sessionId: 'session-a',
      workspaceSnapshot: snapshot,
    })

    const resizeArgs = backendInternal.sessionManager.resize.mock.calls as unknown as Array<
      [sessionId: string, cols: number, rows: number, options?: { sync?: boolean }]
    >
    const firstResize = resizeArgs[0]
    expect(firstResize).toBeDefined()
    expect(firstResize?.[0]).toBe('session-a')
    expect(firstResize?.[1]).toBe(80)
    expect(firstResize?.[2]).toBe(24)
    // The backend derives its own re-anchor from the emulator; no intent map.
    expect(firstResize?.[3]).toBeUndefined()
    expect(backendInternal.sessionManager.resizeTab).not.toHaveBeenCalled()
  })
})
