import { describe, expect, test } from 'bun:test'

import { SessionRegistry } from '../../src/daemon/session-registry'

function createSnapshot() {
  return {
    activeTabId: 'tab-a',
    savedAt: new Date().toISOString(),
    sidebar: { visible: true, width: 28 },
    tabs: [
      {
        assistant: 'claude' as const,
        buffer: 'alpha',
        command: 'claude',
        id: 'tab-a',
        status: 'running' as const,
        terminalModes: {
          alternateScrollMode: false,
          bracketedPasteMode: false,
          isAlternateBuffer: false,
          mouseTrackingMode: 'none' as const,
          sendFocusMode: false,
        },
        title: 'Alpha',
      },
      {
        assistant: 'codex' as const,
        buffer: 'beta',
        command: 'codex',
        id: 'tab-b',
        status: 'running' as const,
        terminalModes: {
          alternateScrollMode: false,
          bracketedPasteMode: false,
          isAlternateBuffer: false,
          mouseTrackingMode: 'none' as const,
          sendFocusMode: false,
        },
        title: 'Beta',
      },
    ],
    version: 1 as const,
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
})
