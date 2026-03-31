import { describe, expect, test } from 'bun:test'

import { SessionRegistry } from '../../src/daemon/session-registry'

function createSnapshot() {
  return {
    version: 1 as const,
    savedAt: new Date().toISOString(),
    activeTabId: 'tab-a',
    sidebar: { visible: true, width: 28 },
    tabs: [
      {
        id: 'tab-a',
        assistant: 'claude' as const,
        title: 'Alpha',
        command: 'claude',
        status: 'running' as const,
        buffer: 'alpha',
        terminalModes: {
          mouseTrackingMode: 'none' as const,
          sendFocusMode: false,
          alternateScrollMode: false,
          isAlternateBuffer: false,
          bracketedPasteMode: false,
        },
      },
      {
        id: 'tab-b',
        assistant: 'codex' as const,
        title: 'Beta',
        command: 'codex',
        status: 'running' as const,
        buffer: 'beta',
        terminalModes: {
          mouseTrackingMode: 'none' as const,
          sendFocusMode: false,
          alternateScrollMode: false,
          isAlternateBuffer: false,
          bracketedPasteMode: false,
        },
      },
    ],
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
