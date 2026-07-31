import { describe, expect, test } from 'bun:test'

import { BAR_MAX_WIDTH, BAR_MIN_WIDTH } from '../../src/state/bars'
import { appReducer, createInitialState } from '../../src/state/store'

describe('initial state', () => {
  test('defaults to navigation mode without startup picker', () => {
    const state = createInitialState()
    expect(state.focusMode).toBe('navigation')
    expect(state.modal.type).toBeNull()
  })

  test('applies persisted bar overrides', () => {
    const state = createInitialState({}, [], [], false, {
      bars: {
        left: { visible: false, widgets: [{ grow: 100, id: 'git', visible: true }], width: 33 },
        right: { visible: false, widgets: [], width: 40 },
      },
    })

    expect(state.bars.left.visible).toBe(false)
    expect(state.bars.left.width).toBe(33)
    expect(state.bars.left.widgets.map((w) => w.id)).toEqual(['git'])
  })

  test('clamps persisted bar width and drops unknown widget ids', () => {
    const state = createInitialState({}, [], [], false, {
      bars: {
        left: { visible: true, widgets: [{ grow: 100, id: 'nope', visible: true }], width: 2 },
        right: { visible: true, widgets: [], width: 200 },
      },
    })

    expect(state.bars.left.width).toBe(18)
    expect(state.bars.left.widgets).toEqual([])
    expect(state.bars.right.width).toBe(80)
  })
})

function createTab(
  overrides: Partial<ReturnType<typeof createInitialState>['tabs'][number]> & {
    id: string
    assistant: 'claude' | 'codex' | 'opencode' | 'grok' | 'kimi' | 'antigravity' | 'terminal'
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
    expect(next.focusMode).toBe('command-edit')
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

  test('activating a tab switches active session worktree', () => {
    const now = '2024-01-01T00:00:00.000Z'
    const initial = {
      ...createInitialState(
        {},
        [
          {
            activeWorktreeId: 'wt-1',
            createdAt: now,
            id: 'session-1',
            lastOpenedAt: now,
            name: 'Main',
            projectPath: '/repo/main',
            updatedAt: now,
            worktrees: [
              {
                createdAt: now,
                createdByAimux: false,
                id: 'wt-1',
                name: 'main',
                path: '/repo/main',
                repoRoot: '/repo/main',
                source: 'primary' as const,
                updatedAt: now,
              },
              {
                createdAt: now,
                createdByAimux: true,
                id: 'wt-2',
                name: 'feature',
                path: '/repo/feature',
                repoRoot: '/repo/main',
                source: 'aimux-temp' as const,
                updatedAt: now,
              },
            ],
          },
        ],
        [],
        false
      ),
      activeTabId: 'tab-1',
      currentSessionId: 'session-1',
      tabs: [
        createTab({
          assistant: 'claude',
          command: 'claude',
          id: 'tab-1',
          status: 'running',
          title: 'Claude',
          worktreeId: 'wt-1',
        }),
        createTab({
          assistant: 'codex',
          command: 'codex',
          id: 'tab-2',
          status: 'running',
          title: 'Codex',
          worktreeId: 'wt-2',
        }),
      ],
    }

    const next = appReducer(initial, { tabId: 'tab-2', type: 'set-active-tab' })
    const session = next.sessions.find((entry) => entry.id === 'session-1')

    expect(session?.activeWorktreeId).toBe('wt-2')
    expect(session?.projectPath).toBe('/repo/feature')
  })

  test('activating a legacy tab leaves active worktree unchanged', () => {
    const now = '2024-01-01T00:00:00.000Z'
    const initial = {
      ...createInitialState(
        {},
        [
          {
            activeWorktreeId: 'wt-1',
            createdAt: now,
            id: 'session-1',
            lastOpenedAt: now,
            name: 'Main',
            projectPath: '/repo/main',
            updatedAt: now,
            worktrees: [
              {
                createdAt: now,
                createdByAimux: false,
                id: 'wt-1',
                name: 'main',
                path: '/repo/main',
                repoRoot: '/repo/main',
                source: 'primary' as const,
                updatedAt: now,
              },
            ],
          },
        ],
        [],
        false
      ),
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

    const next = appReducer(initial, { tabId: 'tab-1', type: 'set-active-tab' })
    const session = next.sessions.find((entry) => entry.id === 'session-1')

    expect(session?.activeWorktreeId).toBe('wt-1')
    expect(session?.projectPath).toBe('/repo/main')
  })

  test('new assistant flow chooses assistant before worktree', () => {
    const now = '2024-01-01T00:00:00.000Z'
    const initial = createInitialState(
      {},
      [
        {
          activeWorktreeId: 'wt-feature',
          createdAt: now,
          id: 'session-1',
          lastOpenedAt: now,
          name: 'Main',
          projectPath: '/repo/feature',
          updatedAt: now,
          worktrees: [
            {
              createdAt: now,
              createdByAimux: false,
              id: 'wt-main',
              name: 'main',
              path: '/repo/main',
              repoRoot: '/repo/main',
              source: 'primary' as const,
              updatedAt: now,
            },
            {
              createdAt: now,
              createdByAimux: true,
              id: 'wt-feature',
              name: 'feature',
              path: '/repo/feature',
              repoRoot: '/repo/main',
              source: 'aimux-temp' as const,
              updatedAt: now,
            },
          ],
        },
      ],
      [],
      false
    )
    const opened = appReducer(
      { ...initial, currentSessionId: 'session-1' },
      { type: 'open-new-tab-modal' }
    )
    expect(opened.modal.type).toBe('new-tab')
    if (opened.modal.type !== 'new-tab') throw new Error('expected new-tab modal')
    expect(opened.modal.step).toBe('assistant')
    expect(opened.modal.targetWorktreeIndex).toBe(1)

    const selected = appReducer(opened, { type: 'select-new-tab-assistant' })
    expect(selected.modal.type).toBe('new-tab')
    if (selected.modal.type !== 'new-tab') throw new Error('expected new-tab modal')
    expect(selected.modal.step).toBe('worktree')
    expect(selected.modal.selectedIndex).toBe(1)
    expect(selected.modal.createWorktree).toBe(false)

    const createNew = appReducer(selected, { delta: 1, type: 'move-modal-selection' })
    expect(createNew.modal.type).toBe('new-tab')
    if (createNew.modal.type !== 'new-tab') throw new Error('expected new-tab modal')
    expect(createNew.modal.selectedIndex).toBe(2)
    expect(createNew.modal.createWorktree).toBe(true)
    expect(createNew.modal.targetWorktreeIndex).toBe(1)
  })

  test('deleting a non-current session keeps the current workspace and modal state', () => {
    const initial = {
      ...createInitialState({}, [
        {
          createdAt: '2024-01-01T00:00:00.000Z',
          id: 'session-1',
          lastOpenedAt: '2024-01-01T00:00:00.000Z',
          name: 'Main',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        {
          createdAt: '2024-01-01T00:00:00.000Z',
          id: 'session-2',
          lastOpenedAt: '2024-01-01T00:00:00.000Z',
          name: 'Other',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ]),
      activeTabId: 'tab-1',
      currentSessionId: 'session-1',
      focusMode: 'navigation' as const,
      sessionStatuses: {
        'session-1': { waiting: false, working: false },
        'session-2': { waiting: true, working: false },
      },
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

    const next = appReducer(initial, { sessionId: 'session-2', type: 'delete-session-record' })
    expect(next.sessions.map((session) => session.id)).toEqual(['session-1'])
    expect(next.currentSessionId).toBe('session-1')
    expect(next.activeTabId).toBe('tab-1')
    expect(next.tabs).toHaveLength(1)
    expect(next.focusMode).toBe('navigation')
    expect(next.modal.type).toBeNull()
    expect(next.sessionStatuses['session-2']).toBeUndefined()
  })

  test('deleting active session from the session bar does not open the picker', () => {
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
    expect(next.activeTabId).toBeNull()
    expect(next.tabs).toHaveLength(0)
    expect(next.focusMode).toBe('navigation')
    expect(next.modal.type).toBeNull()
  })

  test('deleting active session from the picker keeps the picker open', () => {
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
      focusMode: 'modal' as const,
      modal: {
        editBuffer: null,
        selectedIndex: 0,
        sessionTargetId: null,
        type: 'session-picker' as const,
      },
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

    const next = appReducer(initial, {
      openSessionPicker: true,
      sessionId: 'session-1',
      type: 'delete-session-record',
    })
    expect(next.sessions).toHaveLength(0)
    expect(next.currentSessionId).toBeNull()
    expect(next.tabs).toHaveLength(0)
    expect(next.modal.type).toBe('session-picker')
    expect(next.focusMode).toBe('modal')
  })

  test('opens and closes the new tab modal', () => {
    const initial = createInitialState()
    const opened = appReducer(initial, { type: 'open-new-tab-modal' })
    const closed = appReducer(opened, { type: 'close-modal' })

    expect(opened.modal.type).toBe('new-tab')
    expect(opened.focusMode).toBe('command-edit')
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

  test('moves active tab by grouped sidebar worktree order', () => {
    const now = '2024-01-01T00:00:00.000Z'
    const initial = {
      ...createInitialState(
        {},
        [
          {
            activeWorktreeId: 'wt-main',
            createdAt: now,
            id: 'session-1',
            lastOpenedAt: now,
            name: 'Main',
            projectPath: '/repo/main',
            updatedAt: now,
            worktrees: [
              {
                createdAt: now,
                createdByAimux: false,
                id: 'wt-main',
                name: 'main',
                path: '/repo/main',
                repoRoot: '/repo/main',
                source: 'primary' as const,
                updatedAt: now,
              },
              {
                createdAt: now,
                createdByAimux: true,
                id: 'wt-feature',
                name: 'feature',
                path: '/repo/feature',
                repoRoot: '/repo/main',
                source: 'aimux-temp' as const,
                updatedAt: now,
              },
            ],
          },
        ],
        [],
        false
      ),
      activeTabId: 'main-1',
      currentSessionId: 'session-1',
      tabs: [
        createTab({
          assistant: 'claude',
          command: 'claude',
          id: 'main-1',
          status: 'running',
          title: 'Main 1',
          worktreeId: 'wt-main',
        }),
        createTab({
          assistant: 'codex',
          command: 'codex',
          id: 'feature-1',
          status: 'running',
          title: 'Feature 1',
          worktreeId: 'wt-feature',
        }),
        createTab({
          assistant: 'opencode',
          command: 'opencode',
          id: 'main-2',
          status: 'running',
          title: 'Main 2',
          worktreeId: 'wt-main',
        }),
      ],
    }

    const next = appReducer(initial, { delta: 1, type: 'move-active-tab' })
    expect(next.activeTabId).toBe('main-2')
  })

  test('cycles only within the active worktree (does not cross worktrees)', () => {
    const now = '2024-01-01T00:00:00.000Z'
    const sessionWithTwoWorktrees = {
      activeWorktreeId: 'wt-main',
      createdAt: now,
      id: 'session-1',
      lastOpenedAt: now,
      name: 'Main',
      projectPath: '/repo/main',
      updatedAt: now,
      worktrees: [
        {
          createdAt: now,
          createdByAimux: false,
          id: 'wt-main',
          name: 'main',
          path: '/repo/main',
          repoRoot: '/repo/main',
          source: 'primary' as const,
          updatedAt: now,
        },
        {
          createdAt: now,
          createdByAimux: true,
          id: 'wt-feature',
          name: 'feature',
          path: '/repo/feature',
          repoRoot: '/repo/main',
          source: 'aimux-temp' as const,
          updatedAt: now,
        },
      ],
    }
    const tabs = [
      createTab({
        assistant: 'claude',
        command: 'claude',
        id: 'main-1',
        status: 'running' as const,
        title: 'Main 1',
        worktreeId: 'wt-main',
      }),
      createTab({
        assistant: 'codex',
        command: 'codex',
        id: 'main-2',
        status: 'running' as const,
        title: 'Main 2',
        worktreeId: 'wt-main',
      }),
      createTab({
        assistant: 'opencode',
        command: 'opencode',
        id: 'feature-1',
        status: 'running' as const,
        title: 'Feature 1',
        worktreeId: 'wt-feature',
      }),
      createTab({
        assistant: 'terminal',
        command: 'bash',
        id: 'feature-2',
        status: 'running' as const,
        title: 'Feature 2',
        worktreeId: 'wt-feature',
      }),
    ]

    // From last tab of active worktree, +1 wraps to FIRST of same worktree
    // (must not cross to feature-1).
    const fromLastOfActive = {
      ...createInitialState({}, [sessionWithTwoWorktrees], [], false),
      activeTabId: 'main-2',
      currentSessionId: 'session-1',
      tabs,
    }
    const wrapped = appReducer(fromLastOfActive, { delta: 1, type: 'move-active-tab' })
    expect(wrapped.activeTabId).toBe('main-1')

    // Switching the active worktree to wt-feature scopes h/l to its tabs.
    const onFeature = {
      ...createInitialState(
        {},
        [{ ...sessionWithTwoWorktrees, activeWorktreeId: 'wt-feature' }],
        [],
        false
      ),
      activeTabId: 'feature-1',
      currentSessionId: 'session-1',
      tabs,
    }
    const nextOnFeature = appReducer(onFeature, { delta: 1, type: 'move-active-tab' })
    expect(nextOnFeature.activeTabId).toBe('feature-2')
    const wrappedOnFeature = appReducer(
      { ...onFeature, activeTabId: 'feature-2' },
      { delta: 1, type: 'move-active-tab' }
    )
    expect(wrappedOnFeature.activeTabId).toBe('feature-1')
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

    const busy = appReducer(initial, {
      activity: 'working',
      tabId: '1',
      type: 'set-tab-activity',
    })
    const idle = appReducer(busy, { activity: 'idle', tabId: '1', type: 'set-tab-activity' })

    expect(busy.tabs[0]?.activity).toBe('working')
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

  test('clamps bar resize', () => {
    const initial = createInitialState()
    const smaller = appReducer(initial, { delta: -50, side: 'left', type: 'resize-bar' })
    const larger = appReducer(initial, { delta: 99, side: 'left', type: 'resize-bar' })

    expect(smaller.bars.left.width).toBe(BAR_MIN_WIDTH)
    expect(larger.bars.left.width).toBe(BAR_MAX_WIDTH)
  })

  test('reset-tab-session keeps tab but clears runtime state', () => {
    const initial = {
      ...createInitialState(),
      activeTabId: '1',
      focusMode: 'terminal-input' as const,
      tabs: [
        createTab({
          activity: 'working',
          assistant: 'claude',
          buffer: 'old output',
          command: 'claude',
          errorMessage: 'boom',
          exitCode: 2,
          id: '1',
          status: 'error',
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

describe('set-active-worktree remembers the last viewed tab per worktree', () => {
  const now = '2024-01-01T00:00:00.000Z'

  function twoWorktreeSession(activeWorktreeId: 'wt-main' | 'wt-feature') {
    return {
      activeWorktreeId,
      createdAt: now,
      id: 'session-1',
      lastOpenedAt: now,
      name: 'Main',
      projectPath: activeWorktreeId === 'wt-main' ? '/repo/main' : '/repo/feature',
      updatedAt: now,
      worktrees: [
        {
          createdAt: now,
          createdByAimux: false,
          id: 'wt-main',
          name: 'main',
          path: '/repo/main',
          repoRoot: '/repo/main',
          source: 'primary' as const,
          updatedAt: now,
        },
        {
          createdAt: now,
          createdByAimux: true,
          id: 'wt-feature',
          name: 'feature',
          path: '/repo/feature',
          repoRoot: '/repo/main',
          source: 'aimux-temp' as const,
          updatedAt: now,
        },
      ],
    }
  }

  const tabs = [
    createTab({
      assistant: 'claude',
      command: 'claude',
      id: 'main-1',
      status: 'running',
      title: 'Main 1',
      worktreeId: 'wt-main',
    }),
    createTab({
      assistant: 'codex',
      command: 'codex',
      id: 'main-2',
      status: 'running',
      title: 'Main 2',
      worktreeId: 'wt-main',
    }),
    createTab({
      assistant: 'opencode',
      command: 'opencode',
      id: 'feature-1',
      status: 'running',
      title: 'Feature 1',
      worktreeId: 'wt-feature',
    }),
  ]

  test('restores the last viewed tab when switching back to a worktree', () => {
    // On wt-main viewing main-2 (the second tab, not the first).
    const onMain = {
      ...createInitialState({}, [twoWorktreeSession('wt-main')], [], false),
      activeTabId: 'main-2',
      currentSessionId: 'session-1',
      tabs,
    }

    // Switch to wt-feature → lands on its first tab and remembers main-2.
    const onFeature = appReducer(onMain, {
      sessionId: 'session-1',
      type: 'set-active-worktree',
      worktreeId: 'wt-feature',
    })
    expect(onFeature.activeTabId).toBe('feature-1')
    expect(onFeature.lastActiveTabByWorktree['wt-main']).toBe('main-2')

    // Switch back to wt-main → restores main-2 instead of snapping to main-1.
    const backOnMain = appReducer(onFeature, {
      sessionId: 'session-1',
      type: 'set-active-worktree',
      worktreeId: 'wt-main',
    })
    expect(backOnMain.activeTabId).toBe('main-2')
  })

  test('falls back to the first visible tab when no tab is remembered', () => {
    const onMain = {
      ...createInitialState({}, [twoWorktreeSession('wt-main')], [], false),
      activeTabId: 'main-1',
      currentSessionId: 'session-1',
      tabs,
    }

    const onFeature = appReducer(onMain, {
      sessionId: 'session-1',
      type: 'set-active-worktree',
      worktreeId: 'wt-feature',
    })
    expect(onFeature.activeTabId).toBe('feature-1')
  })

  test('falls back to the first visible tab when the remembered tab is gone', () => {
    const onMain = {
      ...createInitialState({}, [twoWorktreeSession('wt-main')], [], false),
      activeTabId: 'main-2',
      currentSessionId: 'session-1',
      lastActiveTabByWorktree: { 'wt-feature': 'feature-removed' },
      tabs,
    }

    const onFeature = appReducer(onMain, {
      sessionId: 'session-1',
      type: 'set-active-worktree',
      worktreeId: 'wt-feature',
    })
    // Remembered feature tab no longer exists → first visible feature tab.
    expect(onFeature.activeTabId).toBe('feature-1')
  })
})
