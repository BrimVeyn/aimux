import { describe, expect, test } from 'bun:test'

import {
  restoreTabsFromWorkspace,
  restoreWorkspaceState,
  serializeWorkspace,
} from '../../src/state/session-persistence'
import { createInitialState } from '../../src/state/store'

describe('session persistence', () => {
  test('serializes workspace snapshot', () => {
    const state = {
      ...createInitialState({ claude: 'claude' }),
      activeTabId: 'tab-1',
      tabs: [
        {
          activity: 'busy' as const,
          assistant: 'claude' as const,
          buffer: 'hello',
          command: 'claude',
          id: 'tab-1',
          status: 'running' as const,
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: true,
            isAlternateBuffer: false,
            mouseTrackingMode: 'drag' as const,
            sendFocusMode: true,
          },
          title: 'Claude',
          viewport: { baseY: 0, cursorVisible: true, lines: [], viewportY: 0 },
        },
      ],
    }

    const snapshot = serializeWorkspace(state)
    expect(snapshot.version).toBe(1)
    expect(snapshot.activeTabId).toBe('tab-1')
    expect(snapshot.tabs[0]?.status).toBe('running')
  })

  test('restores running tabs as disconnected', () => {
    const tabs = restoreTabsFromWorkspace({
      activeTabId: 'tab-1',
      savedAt: new Date().toISOString(),
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          assistant: 'claude',
          buffer: 'hello',
          command: 'claude',
          id: 'tab-1',
          status: 'running',
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'none',
            sendFocusMode: false,
          },
          title: 'Claude',
        },
      ],
      version: 1,
    })

    expect(tabs[0]?.status).toBe('disconnected')
    expect(tabs[0]?.activity).toBe('idle')
  })

  test('restores sidebar and active tab safely', () => {
    const baseState = createInitialState()
    const restored = restoreWorkspaceState(baseState, {
      activeTabId: 'tab-1',
      savedAt: new Date().toISOString(),
      sidebar: { visible: false, width: 22 },
      tabs: [
        {
          assistant: 'claude',
          buffer: 'hello',
          command: 'claude',
          id: 'tab-1',
          status: 'exited',
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'none',
            sendFocusMode: false,
          },
          title: 'Claude',
        },
      ],
      version: 1,
    })

    expect(restored.activeTabId).toBe('tab-1')
    expect(restored.sidebar.visible).toBe(false)
    expect(restored.sidebar.width).toBe(22)
    expect(restored.focusMode).toBe('navigation')
  })
})
