import { describe, expect, test } from 'bun:test'

import type { WorkspaceSnapshotV1 } from '../../src/state/types'

import { SessionRegistry } from '../../src/daemon/session-registry'

function createSnapshotTab(
  id: string,
  title: string,
  assistant: 'claude' | 'codex' | 'terminal' = 'claude',
  command = assistant === 'terminal' ? 'zsh' : assistant
) {
  return {
    assistant,
    buffer: title.toLowerCase(),
    command,
    id,
    status: 'running' as const,
    terminalModes: {
      alternateScrollMode: false,
      bracketedPasteMode: false,
      isAlternateBuffer: false,
      mouseTrackingMode: 'none' as const,
      sendFocusMode: false,
    },
    title,
  }
}

function createSnapshot(overrides?: Partial<WorkspaceSnapshotV1>): WorkspaceSnapshotV1 {
  return {
    activeTabId: 'tab-a',
    savedAt: new Date().toISOString(),
    sidebar: { visible: true, width: 28 },
    tabs: [createSnapshotTab('tab-a', 'Alpha'), createSnapshotTab('tab-b', 'Beta', 'codex')],
    version: 1 as const,
    ...overrides,
  }
}

describe('SessionRegistry', () => {
  test('persists active tab changes across reattach', () => {
    const registry = new SessionRegistry()

    registry.attachFromSnapshot(createSnapshot())
    registry.setActiveTab('tab-b')

    const reattached = registry.attachFromSnapshot(undefined)
    expect(reattached.activeTabId).toBe('tab-b')
  })

  test('ignores unknown active tab ids', () => {
    const registry = new SessionRegistry()

    registry.attachFromSnapshot(createSnapshot())
    registry.setActiveTab('missing-tab')

    expect(registry.attachFromSnapshot(undefined).activeTabId).toBe('tab-a')
  })

  test('reattach returns tabs in snapshot order while keeping groups contiguous', () => {
    const registry = new SessionRegistry()

    registry.attachFromSnapshot(
      createSnapshot({
        tabs: [
          createSnapshotTab('tab-a', 'Alpha'),
          createSnapshotTab('tab-b', 'Beta', 'codex'),
          createSnapshotTab('tab-c', 'Gamma', 'terminal', 'zsh'),
        ],
      })
    )

    const reattached = registry.attachFromSnapshot(
      createSnapshot({
        activeTabId: 'tab-b',
        layoutTrees: {
          'group-1': {
            direction: 'vertical',
            first: { tabId: 'tab-a', type: 'leaf' },
            ratio: 0.5,
            second: { tabId: 'tab-b', type: 'leaf' },
            type: 'split',
          },
        },
        tabGroupMap: {
          'tab-a': 'group-1',
          'tab-b': 'group-1',
        },
        tabs: [
          createSnapshotTab('tab-c', 'Gamma', 'terminal', 'zsh'),
          createSnapshotTab('tab-a', 'Alpha'),
          createSnapshotTab('tab-b', 'Beta', 'codex'),
        ],
      })
    )

    expect(reattached.tabs.map((tab) => tab.id)).toEqual(['tab-c', 'tab-a', 'tab-b'])
  })
})
