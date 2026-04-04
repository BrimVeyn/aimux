import { describe, expect, test } from 'bun:test'

import { appReducer, createInitialState } from '../../src/state/store'

describe('initial state', () => {
  test('can start in startup picker mode', () => {
    const state = createInitialState({}, [], [], true)
    expect(state.focusMode).toBe('modal')
    expect(state.modal.type).toBe('session-picker')
  })

  test('defaults to navigation mode without startup picker', () => {
    const state = createInitialState()
    expect(state.focusMode).toBe('navigation')
    expect(state.modal.type).toBeNull()
  })
})

function createTab(
  overrides: Partial<ReturnType<typeof createInitialState>['tabs'][number]> & {
    id: string
    assistant: 'claude' | 'codex' | 'opencode' | 'terminal'
    title: string
    status: 'starting' | 'running' | 'exited' | 'error'
    command: string
  }
) {
  return {
    buffer: '',
    terminalModes: {
      alternateScrollMode: false,
      bracketedPasteMode: false,
      isAlternateBuffer: false,
      mouseTrackingMode: 'none' as const,
      sendFocusMode: false,
    },
    ...overrides,
  }
}

describe('appReducer', () => {
  test('opens session picker from navigation', () => {
    const initial = createInitialState()
    const next = appReducer(initial, { type: 'open-session-picker' })

    expect(next.modal.type).toBe('session-picker')
    expect(next.focusMode).toBe('modal')
  })

  test('loads selected session and marks it current', () => {
    const initial = {
      ...createInitialState({}, [
        {
          createdAt: '2024-01-01T00:00:00.000Z',
          id: 'session-1',
          lastOpenedAt: '2024-01-01T00:00:00.000Z',
          name: 'Main',
          updatedAt: '2024-01-01T00:00:00.000Z',
          workspaceSnapshot: {
            activeTabId: 'tab-1',
            savedAt: '2024-01-01T00:00:00.000Z',
            sidebar: { visible: false, width: 22 },
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
          },
        },
      ]),
      focusMode: 'modal' as const,
      modal: {
        editBuffer: null,
        selectedIndex: 0,
        sessionTargetId: null,
        type: 'session-picker' as const,
      },
    }

    const next = appReducer(initial, { sessionId: 'session-1', type: 'load-session' })
    expect(next.currentSessionId).toBe('session-1')
    expect(next.activeTabId).toBe('tab-1')
    expect(next.tabs[0]?.status).toBe('disconnected')
    expect(next.focusMode).toBe('navigation')
  })

  test('deleting active session falls back to picker when none remain', () => {
    const initial = {
      ...createInitialState({}, [
        {
          createdAt: '2024-01-01T00:00:00.000Z',
          id: 'session-1',
          lastOpenedAt: '2024-01-01T00:00:00.000Z',
          name: 'Main',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ]),
      activeTabId: 'tab-1',
      currentSessionId: 'session-1',
      tabs: [
        createTab({
          assistant: 'claude',
          command: 'claude',
          id: 'tab-1',
          status: 'running',
          title: 'Claude',
        }),
      ],
    }

    const next = appReducer(initial, { sessionId: 'session-1', type: 'delete-session-record' })
    expect(next.sessions).toHaveLength(0)
    expect(next.currentSessionId).toBeNull()
    expect(next.tabs).toHaveLength(0)
    expect(next.modal.type).toBe('session-picker')
  })

  test('opens and closes the new tab modal', () => {
    const initial = createInitialState()
    const opened = appReducer(initial, { type: 'open-new-tab-modal' })
    const closed = appReducer(opened, { type: 'close-modal' })

    expect(opened.modal.type).toBe('new-tab')
    expect(opened.focusMode).toBe('modal')
    expect(closed.modal.type).toBeNull()
    expect(closed.focusMode).toBe('navigation')
  })

  test('adds a tab and makes it active', () => {
    const initial = createInitialState()
    const next = appReducer(initial, {
      tab: createTab({
        assistant: 'claude',
        command: 'claude',
        id: 'tab-1',
        status: 'starting',
        title: 'Claude',
      }),
      type: 'add-tab',
    })

    expect(next.tabs).toHaveLength(1)
    expect(next.activeTabId).toBe('tab-1')
    expect(next.modal.type).toBeNull()
    expect(next.tabs[0]?.activity).toBe('idle')
  })

  test('moves active tab vertically', () => {
    const initial = {
      ...createInitialState(),
      activeTabId: '1',
      tabs: [
        createTab({
          assistant: 'claude',
          command: 'claude',
          id: '1',
          status: 'running',
          title: 'Claude',
        }),
        createTab({
          assistant: 'codex',
          command: 'codex',
          id: '2',
          status: 'running',
          title: 'Codex',
        }),
      ],
    }

    const next = appReducer(initial, { delta: 1, type: 'move-active-tab' })
    expect(next.activeTabId).toBe('2')
  })

  test('wraps from last tab to first tab', () => {
    const initial = {
      ...createInitialState(),
      activeTabId: '3',
      tabs: [
        createTab({
          assistant: 'claude',
          command: 'claude',
          id: '1',
          status: 'running',
          title: 'Claude',
        }),
        createTab({
          assistant: 'codex',
          command: 'codex',
          id: '2',
          status: 'running',
          title: 'Codex',
        }),
        createTab({
          assistant: 'opencode',
          command: 'opencode',
          id: '3',
          status: 'running',
          title: 'OpenCode',
        }),
      ],
    }

    const next = appReducer(initial, { delta: 1, type: 'move-active-tab' })
    expect(next.activeTabId).toBe('1')
  })

  test('wraps from first tab to last tab', () => {
    const initial = {
      ...createInitialState(),
      activeTabId: '1',
      tabs: [
        createTab({
          assistant: 'claude',
          command: 'claude',
          id: '1',
          status: 'running',
          title: 'Claude',
        }),
        createTab({
          assistant: 'codex',
          command: 'codex',
          id: '2',
          status: 'running',
          title: 'Codex',
        }),
        createTab({
          assistant: 'opencode',
          command: 'opencode',
          id: '3',
          status: 'running',
          title: 'OpenCode',
        }),
      ],
    }

    const next = appReducer(initial, { delta: -1, type: 'move-active-tab' })
    expect(next.activeTabId).toBe('3')
  })

  test('does not create a new state when wrapping lands on the same tab', () => {
    const initial = {
      ...createInitialState(),
      activeTabId: '1',
      tabs: [
        createTab({
          assistant: 'claude',
          command: 'claude',
          id: '1',
          status: 'running',
          title: 'Claude',
        }),
      ],
    }

    const next = appReducer(initial, { delta: 1, type: 'move-active-tab' })
    expect(next).toBe(initial)
  })

  test('closes the active tab and picks the next tab at same index', () => {
    const initial = {
      ...createInitialState(),
      activeTabId: '2',
      tabs: [
        createTab({
          assistant: 'claude',
          command: 'claude',
          id: '1',
          status: 'running',
          title: 'Claude',
        }),
        createTab({
          assistant: 'codex',
          command: 'codex',
          id: '2',
          status: 'running',
          title: 'Codex',
        }),
        createTab({
          assistant: 'opencode',
          command: 'opencode',
          id: '3',
          status: 'running',
          title: 'OpenCode',
        }),
      ],
    }

    const next = appReducer(initial, { type: 'close-active-tab' })
    expect(next.tabs.map((tab) => tab.id)).toEqual(['1', '3'])
    expect(next.activeTabId).toBe('3')
  })

  test('closes the last remaining tab to empty state', () => {
    const initial = {
      ...createInitialState(),
      activeTabId: '1',
      focusMode: 'terminal-input' as const,
      tabs: [
        createTab({
          assistant: 'claude',
          command: 'claude',
          id: '1',
          status: 'running',
          title: 'Claude',
        }),
      ],
    }

    const next = appReducer(initial, { type: 'close-active-tab' })
    expect(next.tabs).toHaveLength(0)
    expect(next.activeTabId).toBeNull()
    expect(next.focusMode).toBe('navigation')
  })

  test('closes a background tab without changing active tab', () => {
    const initial = {
      ...createInitialState(),
      activeTabId: '1',
      tabs: [
        createTab({
          assistant: 'claude',
          command: 'claude',
          id: '1',
          status: 'running',
          title: 'Claude',
        }),
        createTab({
          assistant: 'codex',
          command: 'codex',
          id: '2',
          status: 'running',
          title: 'Codex',
        }),
      ],
    }

    const next = appReducer(initial, { tabId: '2', type: 'close-tab' })
    expect(next.tabs.map((tab) => tab.id)).toEqual(['1'])
    expect(next.activeTabId).toBe('1')
  })

  test('ignores unknown tab id when closing by id', () => {
    const initial = {
      ...createInitialState(),
      activeTabId: '1',
      tabs: [
        createTab({
          assistant: 'claude',
          command: 'claude',
          id: '1',
          status: 'running',
          title: 'Claude',
        }),
      ],
    }

    const next = appReducer(initial, { tabId: 'missing', type: 'close-tab' })
    expect(next).toEqual(initial)
  })

  test('updates tab activity state', () => {
    const initial = {
      ...createInitialState(),
      activeTabId: '1',
      tabs: [
        createTab({
          assistant: 'claude',
          command: 'claude',
          id: '1',
          status: 'running',
          title: 'Claude',
        }),
      ],
    }

    const busy = appReducer(initial, { activity: 'busy', tabId: '1', type: 'set-tab-activity' })
    const idle = appReducer(busy, { activity: 'idle', tabId: '1', type: 'set-tab-activity' })

    expect(busy.tabs[0]?.activity).toBe('busy')
    expect(idle.tabs[0]?.activity).toBe('idle')
  })

  test('reorders active tab upward without changing the active id', () => {
    const initial = {
      ...createInitialState(),
      activeTabId: '2',
      tabs: [
        createTab({
          assistant: 'claude',
          command: 'claude',
          id: '1',
          status: 'running',
          title: 'Claude',
        }),
        createTab({
          assistant: 'codex',
          command: 'codex',
          id: '2',
          status: 'running',
          title: 'Codex',
        }),
        createTab({
          assistant: 'opencode',
          command: 'opencode',
          id: '3',
          status: 'running',
          title: 'OpenCode',
        }),
      ],
    }

    const next = appReducer(initial, { delta: -1, type: 'reorder-active-tab' })
    expect(next.tabs.map((tab) => tab.id)).toEqual(['2', '1', '3'])
    expect(next.activeTabId).toBe('2')
  })

  test('does not reorder beyond boundaries', () => {
    const initial = {
      ...createInitialState(),
      activeTabId: '1',
      tabs: [
        createTab({
          assistant: 'claude',
          command: 'claude',
          id: '1',
          status: 'running',
          title: 'Claude',
        }),
        createTab({
          assistant: 'codex',
          command: 'codex',
          id: '2',
          status: 'running',
          title: 'Codex',
        }),
      ],
    }

    const next = appReducer(initial, { delta: -1, type: 'reorder-active-tab' })
    expect(next.tabs.map((tab) => tab.id)).toEqual(['1', '2'])
  })

  test('clamps sidebar resize', () => {
    const initial = createInitialState()
    const smaller = appReducer(initial, { delta: -50, type: 'resize-sidebar' })
    const larger = appReducer(initial, { delta: 99, type: 'resize-sidebar' })

    expect(smaller.sidebar.width).toBe(initial.sidebar.minWidth)
    expect(larger.sidebar.width).toBe(initial.sidebar.maxWidth)
  })

  test('reset-tab-session keeps tab but clears runtime state', () => {
    const initial = {
      ...createInitialState(),
      activeTabId: '1',
      focusMode: 'terminal-input' as const,
      tabs: [
        createTab({
          activity: 'busy',
          assistant: 'claude',
          buffer: 'old output',
          command: 'claude',
          errorMessage: 'boom',
          exitCode: 2,
          id: '1',
          status: 'exited',
          terminalModes: {
            alternateScrollMode: true,
            bracketedPasteMode: true,
            isAlternateBuffer: true,
            mouseTrackingMode: 'drag',
            sendFocusMode: true,
          },
          title: 'Claude',
          viewport: { baseY: 2, cursorVisible: true, lines: [], viewportY: 1 },
        }),
      ],
    }

    const next = appReducer(initial, { tabId: '1', type: 'reset-tab-session' })
    expect(next.activeTabId).toBe('1')
    expect(next.focusMode).toBe('navigation')
    expect(next.tabs[0]).toMatchObject({
      activity: 'idle',
      buffer: '',
      errorMessage: undefined,
      exitCode: undefined,
      status: 'starting',
      terminalModes: {
        alternateScrollMode: false,
        bracketedPasteMode: false,
        isAlternateBuffer: false,
        mouseTrackingMode: 'none',
        sendFocusMode: false,
      },
      viewport: undefined,
    })
  })
})
