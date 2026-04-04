import { describe, expect, test } from 'bun:test'

import { SessionManager } from '../../src/daemon/session-manager'

describe('SessionManager', () => {
  test('returns correct snapshot for each session', () => {
    const manager = new SessionManager()

    const alpha = manager.attachSession('alpha', {
      activeTabId: 'tab-a',
      savedAt: new Date().toISOString(),
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          assistant: 'claude',
          buffer: 'alpha',
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
    })

    const beta = manager.attachSession('beta', {
      activeTabId: 'tab-b',
      savedAt: new Date().toISOString(),
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          assistant: 'codex',
          buffer: 'beta',
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
    })

    expect(alpha.tabs[0]?.title).toBe('Alpha')
    expect(beta.tabs[0]?.title).toBe('Beta')
    expect(alpha.activeTabId).toBe('tab-a')
    expect(beta.activeTabId).toBe('tab-b')
  })

  test('does not leak tabs into empty sessions', () => {
    const manager = new SessionManager()

    manager.attachSession('alpha', {
      activeTabId: 'tab-a',
      savedAt: new Date().toISOString(),
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          assistant: 'claude',
          buffer: 'alpha',
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
    })

    const empty = manager.attachSession('beta', {
      activeTabId: null,
      savedAt: new Date().toISOString(),
      sidebar: { visible: true, width: 28 },
      tabs: [],
      version: 1,
    })

    expect(empty.tabs).toEqual([])
    expect(empty.activeTabId).toBeNull()
  })

  test('tracks active tabs independently per session', () => {
    const manager = new SessionManager()

    manager.attachSession('alpha', {
      activeTabId: 'tab-a',
      savedAt: new Date().toISOString(),
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          assistant: 'claude',
          buffer: 'alpha',
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
          assistant: 'claude',
          buffer: 'alpha2',
          command: 'claude',
          id: 'tab-a-2',
          status: 'running',
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'none',
            sendFocusMode: false,
          },
          title: 'Alpha 2',
        },
      ],
      version: 1,
    })
    manager.attachSession('beta', {
      activeTabId: 'tab-b',
      savedAt: new Date().toISOString(),
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          assistant: 'codex',
          buffer: 'beta',
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
        {
          assistant: 'codex',
          buffer: 'beta2',
          command: 'codex',
          id: 'tab-b-2',
          status: 'running',
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'none',
            sendFocusMode: false,
          },
          title: 'Beta 2',
        },
      ],
      version: 1,
    })

    manager.setActiveTab('alpha', 'tab-a-2')
    manager.setActiveTab('beta', 'tab-b-2')

    expect(manager.attachSession('alpha').activeTabId).toBe('tab-a-2')
    expect(manager.attachSession('beta').activeTabId).toBe('tab-b-2')
  })
})
