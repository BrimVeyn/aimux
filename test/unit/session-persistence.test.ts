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
      tabs: [
        {
          id: 'tab-1',
          assistant: 'claude' as const,
          title: 'Claude',
          status: 'running' as const,
          activity: 'busy' as const,
          buffer: 'hello',
          viewport: { lines: [], viewportY: 0, baseY: 0, cursorVisible: true },
          terminalModes: {
            mouseTrackingMode: 'drag' as const,
            sendFocusMode: true,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: true,
          },
          command: 'claude',
        },
      ],
      activeTabId: 'tab-1',
    }

    const snapshot = serializeWorkspace(state)
    expect(snapshot.version).toBe(1)
    expect(snapshot.activeTabId).toBe('tab-1')
    expect(snapshot.tabs[0]?.status).toBe('running')
  })

  test('restores running tabs as disconnected', () => {
    const tabs = restoreTabsFromWorkspace({
      version: 1,
      savedAt: new Date().toISOString(),
      activeTabId: 'tab-1',
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          id: 'tab-1',
          assistant: 'claude',
          title: 'Claude',
          command: 'claude',
          status: 'running',
          buffer: 'hello',
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

    expect(tabs[0]?.status).toBe('disconnected')
    expect(tabs[0]?.activity).toBe('idle')
  })

  test('restores sidebar and active tab safely', () => {
    const baseState = createInitialState()
    const restored = restoreWorkspaceState(baseState, {
      version: 1,
      savedAt: new Date().toISOString(),
      activeTabId: 'tab-1',
      sidebar: { visible: false, width: 22 },
      tabs: [
        {
          id: 'tab-1',
          assistant: 'claude',
          title: 'Claude',
          command: 'claude',
          status: 'exited',
          buffer: 'hello',
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

    expect(restored.activeTabId).toBe('tab-1')
    expect(restored.sidebar.visible).toBe(false)
    expect(restored.sidebar.width).toBe(22)
    expect(restored.focusMode).toBe('navigation')
  })
})
