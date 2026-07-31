import { describe, expect, test } from 'bun:test'

import {
  pruneSnapshotOfWorktree,
  restoreTabsFromWorkspace,
  restoreWorkspaceState,
  serializeWorkspace,
} from '../../src/state/project-persistence'
import { createInitialState } from '../../src/state/store'

describe('project persistence', () => {
  test('round-trips auto-rename status in workspace snapshots', () => {
    const state = createInitialState({ claude: 'claude' })
    state.tabs = [
      {
        assistant: 'claude',
        autoRenameStatus: 'attempted',
        buffer: '',
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
        title: 'Cache fix',
      },
    ]
    const snapshot = serializeWorkspace(state)
    expect(snapshot.tabs[0]?.autoRenameStatus).toBe('attempted')
    expect(restoreTabsFromWorkspace(snapshot)[0]?.autoRenameStatus).toBe('attempted')
  })
  test('serializes workspace snapshot', () => {
    const state = {
      ...createInitialState({ claude: 'claude' }),
      activeTabId: 'tab-1',
      tabs: [
        {
          activity: 'working' as const,
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

  test('persists per-worktree last-tab memory without bumping the version', () => {
    const state = {
      ...createInitialState(),
      lastActiveTabByWorktree: { 'wt-feature': 'feature-2', 'wt-main': 'main-2' },
    }

    const snapshot = serializeWorkspace(state)
    expect(snapshot.version).toBe(1)
    expect(snapshot.lastActiveTabByWorktree).toEqual({
      'wt-feature': 'feature-2',
      'wt-main': 'main-2',
    })
  })

  test('omits the per-worktree memory when empty', () => {
    const snapshot = serializeWorkspace(createInitialState())
    expect(snapshot.lastActiveTabByWorktree).toBeUndefined()
  })

  test('restoring stays dormant: does not surface the persisted per-worktree memory yet', () => {
    const state = createInitialState()
    const restored = restoreWorkspaceState(state, {
      activeTabId: null,
      lastActiveTabByWorktree: { 'wt-main': 'main-2' },
      savedAt: new Date().toISOString(),
      sidebar: { visible: true, width: 28 },
      tabs: [],
      version: 1,
    })
    // Gate is off → the key is omitted so spreading the result can't clobber a
    // caller's live in-memory map on a project switch.
    expect(restored.lastActiveTabByWorktree).toBeUndefined()
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

  test('prunes tabs pinned to worktrees the project no longer owns', () => {
    const mkTab = (id: string, worktreeId?: string) => ({
      assistant: 'claude' as const,
      buffer: '',
      command: 'claude',
      id,
      status: 'running' as const,
      terminalModes: {
        alternateScrollMode: false,
        bracketedPasteMode: false,
        isAlternateBuffer: false,
        mouseTrackingMode: 'none' as const,
        sendFocusMode: false,
      },
      title: 'Claude',
      worktreeId,
    })

    const tabs = restoreTabsFromWorkspace(
      {
        activeTabId: 'tab-live',
        savedAt: new Date().toISOString(),
        sidebar: { visible: true, width: 28 },
        tabs: [
          mkTab('tab-live', 'wt-main'),
          mkTab('tab-orphan', 'wt-deleted'),
          mkTab('tab-unbound'),
        ],
        version: 1,
      },
      { validWorktreeIds: new Set(['wt-main']) }
    )

    // Orphan dropped; live + unbound (legacy) tabs kept.
    expect(tabs.map((t) => t.id)).toEqual(['tab-live', 'tab-unbound'])
  })

  test('keeps all tabs when no valid worktree set is provided', () => {
    const mkTab = (id: string, worktreeId?: string) => ({
      assistant: 'claude' as const,
      buffer: '',
      command: 'claude',
      id,
      status: 'running' as const,
      terminalModes: {
        alternateScrollMode: false,
        bracketedPasteMode: false,
        isAlternateBuffer: false,
        mouseTrackingMode: 'none' as const,
        sendFocusMode: false,
      },
      title: 'Claude',
      worktreeId,
    })

    const tabs = restoreTabsFromWorkspace({
      activeTabId: 'tab-1',
      savedAt: new Date().toISOString(),
      sidebar: { visible: true, width: 28 },
      tabs: [mkTab('tab-1', 'wt-a'), mkTab('tab-2', 'wt-gone')],
      version: 1,
    })

    expect(tabs.map((t) => t.id)).toEqual(['tab-1', 'tab-2'])
  })

  test('drops legacy exited tabs from snapshots', () => {
    const initialState = createInitialState()
    const baseState = {
      ...initialState,
      bars: {
        ...initialState.bars,
        left: { ...initialState.bars.left, visible: true, width: 31 },
      },
    }
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

    expect(restored.tabs).toHaveLength(0)
    expect(restored.activeTabId).toBeNull()
    expect(restored.focusMode).toBe('navigation')
  })

  test('restores grouped tabs as contiguous blocks', () => {
    const baseState = createInitialState()
    const restored = restoreWorkspaceState(baseState, {
      activeTabId: 'tab-2',
      layoutTrees: {
        'group-1': {
          direction: 'vertical',
          first: { tabId: 'tab-3', type: 'leaf' },
          ratio: 0.5,
          second: { tabId: 'tab-2', type: 'leaf' },
          type: 'split',
        },
      },
      savedAt: new Date().toISOString(),
      sidebar: { visible: true, width: 28 },
      tabGroupMap: {
        'tab-2': 'group-1',
        'tab-3': 'group-1',
      },
      tabs: [
        {
          assistant: 'claude',
          buffer: '',
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
          title: 'Standalone',
        },
        {
          assistant: 'claude',
          buffer: '',
          command: 'claude',
          id: 'tab-2',
          status: 'running',
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'none',
            sendFocusMode: false,
          },
          title: 'Grouped 1',
        },
        {
          assistant: 'terminal',
          buffer: '',
          command: 'zsh',
          id: 'tab-4',
          status: 'running',
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'none',
            sendFocusMode: false,
          },
          title: 'Standalone 2',
        },
        {
          assistant: 'codex',
          buffer: '',
          command: 'codex',
          id: 'tab-3',
          status: 'running',
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'none',
            sendFocusMode: false,
          },
          title: 'Grouped 2',
        },
      ],
      version: 1,
    })

    expect(restored.tabs.map((tab) => tab.id)).toEqual(['tab-1', 'tab-2', 'tab-3', 'tab-4'])
  })

  test('prunes snapshot tabs belonging to a removed worktree', () => {
    const terminalModes = {
      alternateScrollMode: false,
      bracketedPasteMode: false,
      isAlternateBuffer: false,
      mouseTrackingMode: 'none' as const,
      sendFocusMode: false,
    }
    const snapshot = {
      activeTabId: 'feature-1',
      layoutTrees: {
        'group-1': {
          direction: 'vertical' as const,
          first: { tabId: 'feature-1', type: 'leaf' as const },
          ratio: 0.5,
          second: { tabId: 'feature-2', type: 'leaf' as const },
          type: 'split' as const,
        },
        'group-2': {
          direction: 'horizontal' as const,
          first: { tabId: 'main-1', type: 'leaf' as const },
          ratio: 0.4,
          second: { tabId: 'main-2', type: 'leaf' as const },
          type: 'split' as const,
        },
      },
      savedAt: new Date().toISOString(),
      sidebar: { visible: true, width: 28 },
      tabGroupMap: {
        'feature-1': 'group-1',
        'feature-2': 'group-1',
        'main-1': 'group-2',
        'main-2': 'group-2',
      },
      tabs: [
        {
          assistant: 'claude' as const,
          buffer: '',
          command: 'claude',
          id: 'main-1',
          status: 'running' as const,
          terminalModes,
          title: 'Main 1',
          worktreeId: 'wt-main',
        },
        {
          assistant: 'codex' as const,
          buffer: '',
          command: 'codex',
          id: 'main-2',
          status: 'running' as const,
          terminalModes,
          title: 'Main 2',
          worktreeId: 'wt-main',
        },
        {
          assistant: 'claude' as const,
          buffer: '',
          command: 'claude',
          id: 'feature-1',
          status: 'running' as const,
          terminalModes,
          title: 'Feature 1',
          worktreeId: 'wt-feature',
        },
        {
          assistant: 'opencode' as const,
          buffer: '',
          command: 'opencode',
          id: 'feature-2',
          status: 'running' as const,
          terminalModes,
          title: 'Feature 2',
          worktreeId: 'wt-feature',
        },
      ],
      version: 1 as const,
    }

    const pruned = pruneSnapshotOfWorktree(snapshot, 'wt-feature')
    expect(pruned).toBeDefined()
    expect(pruned?.tabs.map((tab) => tab.id)).toEqual(['main-1', 'main-2'])
    expect(pruned?.tabs.some((tab) => tab.worktreeId === 'wt-feature')).toBe(false)
    // The group whose leaves were all from wt-feature is gone; the main group survives.
    expect(Object.keys(pruned?.layoutTrees ?? {})).toEqual(['group-2'])
    expect(pruned?.tabGroupMap).toEqual({ 'main-1': 'group-2', 'main-2': 'group-2' })
    // activeTabId pointed at a pruned tab → falls back to first surviving tab.
    expect(pruned?.activeTabId).toBe('main-1')
  })

  test('returns the same snapshot reference when no tab matches the removed worktree', () => {
    const snapshot = {
      activeTabId: null,
      savedAt: new Date().toISOString(),
      sidebar: { visible: true, width: 28 },
      tabs: [],
      version: 1 as const,
    }
    expect(pruneSnapshotOfWorktree(snapshot, 'wt-anything')).toBe(snapshot)
  })

  test('returns undefined when snapshot is undefined', () => {
    expect(pruneSnapshotOfWorktree(undefined, 'wt-x')).toBeUndefined()
  })
})
