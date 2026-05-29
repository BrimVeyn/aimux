import { describe, expect, mock, test } from 'bun:test'

import type { SessionBackend } from '../../src/session-backend/types'
import type { LayoutState, WorkspaceSnapshotV1 } from '../../src/state/types'

import { resizeSnapshotPanes } from '../../src/app-runtime/backend-attach-runtime'

function createSnapshot(): WorkspaceSnapshotV1 {
  return {
    activeTabId: 'tab-a',
    layoutTree: {
      direction: 'horizontal',
      first: { tabId: 'tab-a', type: 'leaf' },
      ratio: 0.5,
      second: { tabId: 'tab-b', type: 'leaf' },
      type: 'split',
    },
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
      {
        assistant: 'codex',
        buffer: '',
        command: 'codex',
        id: 'tab-b',
        status: 'running',
        terminalModes: {
          alternateScrollMode: false,
          bracketedPasteMode: false,
          isAlternateBuffer: false,
          mouseTrackingMode: 'none',
          sendFocusMode: false,
        },
        title: 'Beta',
      },
    ],
    version: 1,
  }
}

describe('resizeSnapshotPanes', () => {
  test('resizes each snapshot pane without sending a scroll intent', () => {
    const backend = {
      resizeTab: mock(() => {}),
    }
    const layoutRef = {
      current: {
        terminalCols: 120,
        terminalRows: 40,
      } satisfies LayoutState,
    }

    resizeSnapshotPanes(createSnapshot(), layoutRef, backend as unknown as SessionBackend)

    const calls = backend.resizeTab.mock.calls as unknown as Array<
      [tabId: string, cols: number, rows: number, options?: { sync?: boolean }]
    >
    expect(calls).toHaveLength(2)
    const firstCall = calls[0]
    const secondCall = calls[1]
    expect(firstCall).toBeDefined()
    expect(secondCall).toBeDefined()
    expect(firstCall?.[0]).toBe('tab-a')
    expect(secondCall?.[0]).toBe('tab-b')
    // The backend owns scroll: no per-tab intent is threaded through resize.
    expect(firstCall?.[3]).toBeUndefined()
    expect(secondCall?.[3]).toBeUndefined()
  })
})
