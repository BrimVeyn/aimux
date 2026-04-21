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
        scrollIntent: { absoluteLine: 11, kind: 'anchor' },
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
  test('passes persisted scroll intents to full-session resize during attach', async () => {
    const backend = new LocalSessionBackend() as unknown as LocalSessionBackend & {
      currentSessionId: string | null
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
    backend.sessionManager = {
      attachSession: mock(() => ({ activeTabId: 'tab-a', tabs: attachTabs })),
      listTabs: mock(() => attachTabs),
      resize: mock(() => {}),
      resizeTab: mock(() => {}),
    }
    backend.statusLoop = {
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

    const resizeArgs = backend.sessionManager.resize.mock.calls[0]
    expect(resizeArgs?.[0]).toBe('session-a')
    expect(resizeArgs?.[1]).toBe(80)
    expect(resizeArgs?.[2]).toBe(24)
    expect(resizeArgs?.[3]).toEqual(new Map([['tab-a', { absoluteLine: 11, kind: 'anchor' }]]))
    expect(backend.sessionManager.resizeTab).not.toHaveBeenCalled()
  })
})
