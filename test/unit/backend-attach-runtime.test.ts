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
        scrollIntent: { absoluteLine: 9, kind: 'anchor' },
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
        scrollIntent: { kind: 'bottom' },
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
  test('passes persisted scrollIntent to backend.resizeTab', () => {
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

    const calls = backend.resizeTab.mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0]?.[0]).toBe('tab-a')
    expect(calls[0]?.[3]).toEqual({ absoluteLine: 9, kind: 'anchor' })
    expect(calls[1]?.[0]).toBe('tab-b')
    expect(calls[1]?.[3]).toEqual({ kind: 'bottom' })
  })
})
