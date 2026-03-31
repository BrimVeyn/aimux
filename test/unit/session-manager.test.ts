import { describe, expect, test } from 'bun:test'

import { SessionManager } from '../../src/daemon/session-manager'

describe('SessionManager', () => {
  test('returns correct snapshot for each session', () => {
    const manager = new SessionManager()

    const alpha = manager.attachSession('alpha', {
      version: 1,
      savedAt: new Date().toISOString(),
      activeTabId: 'tab-a',
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          id: 'tab-a',
          assistant: 'claude',
          title: 'Alpha',
          command: 'claude',
          status: 'running',
          buffer: 'alpha',
          terminalModes: {
            mouseTrackingMode: 'none',
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
        },
      ],
    })

    const beta = manager.attachSession('beta', {
      version: 1,
      savedAt: new Date().toISOString(),
      activeTabId: 'tab-b',
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          id: 'tab-b',
          assistant: 'codex',
          title: 'Beta',
          command: 'codex',
          status: 'running',
          buffer: 'beta',
          terminalModes: {
            mouseTrackingMode: 'none',
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
        },
      ],
    })

    expect(alpha.tabs[0]?.title).toBe('Alpha')
    expect(beta.tabs[0]?.title).toBe('Beta')
    expect(alpha.activeTabId).toBe('tab-a')
    expect(beta.activeTabId).toBe('tab-b')
  })

  test('does not leak tabs into empty sessions', () => {
    const manager = new SessionManager()

    manager.attachSession('alpha', {
      version: 1,
      savedAt: new Date().toISOString(),
      activeTabId: 'tab-a',
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          id: 'tab-a',
          assistant: 'claude',
          title: 'Alpha',
          command: 'claude',
          status: 'running',
          buffer: 'alpha',
          terminalModes: {
            mouseTrackingMode: 'none',
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
        },
      ],
    })

    const empty = manager.attachSession('beta', {
      version: 1,
      savedAt: new Date().toISOString(),
      activeTabId: null,
      sidebar: { visible: true, width: 28 },
      tabs: [],
    })

    expect(empty.tabs).toEqual([])
    expect(empty.activeTabId).toBeNull()
  })

  test('tracks active tabs independently per session', () => {
    const manager = new SessionManager()

    manager.attachSession('alpha', {
      version: 1,
      savedAt: new Date().toISOString(),
      activeTabId: 'tab-a',
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          id: 'tab-a',
          assistant: 'claude',
          title: 'Alpha',
          command: 'claude',
          status: 'running',
          buffer: 'alpha',
          terminalModes: {
            mouseTrackingMode: 'none',
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
        },
        {
          id: 'tab-a-2',
          assistant: 'claude',
          title: 'Alpha 2',
          command: 'claude',
          status: 'running',
          buffer: 'alpha2',
          terminalModes: {
            mouseTrackingMode: 'none',
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
        },
      ],
    })
    manager.attachSession('beta', {
      version: 1,
      savedAt: new Date().toISOString(),
      activeTabId: 'tab-b',
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          id: 'tab-b',
          assistant: 'codex',
          title: 'Beta',
          command: 'codex',
          status: 'running',
          buffer: 'beta',
          terminalModes: {
            mouseTrackingMode: 'none',
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
        },
        {
          id: 'tab-b-2',
          assistant: 'codex',
          title: 'Beta 2',
          command: 'codex',
          status: 'running',
          buffer: 'beta2',
          terminalModes: {
            mouseTrackingMode: 'none',
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
        },
      ],
    })

    manager.setActiveTab('alpha', 'tab-a-2')
    manager.setActiveTab('beta', 'tab-b-2')

    expect(manager.attachSession('alpha').activeTabId).toBe('tab-a-2')
    expect(manager.attachSession('beta').activeTabId).toBe('tab-b-2')
  })
})
