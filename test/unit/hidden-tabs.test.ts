import { describe, expect, test } from 'bun:test'

import type { AppState, ProjectRecord, TabSession, WorkspaceRecord } from '../../src/state/types'

import { serializeProject } from '../../src/state/project-persistence'
import { filterTabsForActiveWorkspace } from '../../src/state/project-workspaces'
import { appReducer, createInitialState } from '../../src/state/store'

function tab(overrides: Partial<TabSession> & { id: string }): TabSession {
  return {
    assistant: 'terminal',
    buffer: '',
    command: 'bash',
    status: 'running',
    terminalModes: {
      alternateScrollMode: false,
      bracketedPasteMode: false,
      isAlternateBuffer: false,
      mouseTrackingMode: 'none',
      sendFocusMode: false,
    },
    title: 'tab',
    ...overrides,
  }
}

function workspace(id: string, name: string): WorkspaceRecord {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    createdByAimux: false,
    id,
    name,
    path: `/repo/${name}`,
    repoRoot: '/repo',
    source: id === 'ws-primary' ? 'primary' : 'aimux-temp',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function project(activeWorkspaceId?: string): ProjectRecord {
  return {
    activeWorkspaceId,
    createdAt: '2026-01-01T00:00:00.000Z',
    id: 'proj-1',
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
    name: 'proj',
    updatedAt: '2026-01-01T00:00:00.000Z',
    workspaces: [workspace('ws-primary', 'root'), workspace('ws-2', 'feature')],
  }
}

describe('filterTabsForActiveWorkspace drops hidden tabs', () => {
  const tabs = [
    tab({ id: 'visible', workspaceId: 'ws-2' }),
    tab({ hidden: true, id: 'setup', workspaceId: 'ws-2' }),
  ]

  test('on the normal workspace-scoped path', () => {
    expect(filterTabsForActiveWorkspace(tabs, project('ws-2')).map((t) => t.id)).toEqual([
      'visible',
    ])
  })

  test('on the no-project early-exit path', () => {
    // This branch used to `return tabs` unfiltered, which is exactly the hole
    // a hidden tab would slip through at boot.
    expect(filterTabsForActiveWorkspace(tabs, undefined).map((t) => t.id)).toEqual(['visible'])
  })

  test('on the no-active-workspace early-exit path', () => {
    expect(filterTabsForActiveWorkspace(tabs, project(undefined)).map((t) => t.id)).toEqual([
      'visible',
    ])
  })
})

describe('add-tab with hidden: true', () => {
  function baseState(): AppState {
    return {
      ...createInitialState(),
      activeTabId: 'visible',
      currentProjectId: 'proj-1',
      focusMode: 'terminal-input',
      projects: [project('ws-2')],
      tabs: [tab({ id: 'visible', workspaceId: 'ws-2' })],
    }
  }

  test('does not steal activeTabId, focus, or the open modal', () => {
    const withModal = appReducer(baseState(), { type: 'open-new-tab-modal' })
    const next = appReducer(withModal, {
      tab: tab({ hidden: true, id: 'setup', workspaceId: 'ws-2' }),
      type: 'add-tab',
    })

    expect(next.tabs.map((t) => t.id)).toEqual(['visible', 'setup'])
    expect(next.activeTabId).toBe('visible')
    expect(next.modal.type).toBe('new-tab')
  })

  test('does not re-sync the project onto the tab workspace', () => {
    // The teleport bug: a setup tab bound to ws-2 must not drag a user sitting
    // on ws-primary over to ws-2.
    const state: AppState = { ...baseState(), projects: [project('ws-primary')] }
    const next = appReducer(state, {
      tab: tab({ hidden: true, id: 'setup', workspaceId: 'ws-2' }),
      type: 'add-tab',
    })

    expect(next.projects[0]?.activeWorkspaceId).toBe('ws-primary')
  })

  test('a visible tab still steals focus and syncs the workspace', () => {
    const next = appReducer(
      { ...baseState(), projects: [project('ws-primary')] },
      { tab: tab({ id: 'other', workspaceId: 'ws-2' }), type: 'add-tab' }
    )

    expect(next.activeTabId).toBe('other')
    expect(next.focusMode).toBe('navigation')
    expect(next.projects[0]?.activeWorkspaceId).toBe('ws-2')
  })
})

describe('close-tab next-active pick', () => {
  test('never lands on a hidden tab', () => {
    const state: AppState = {
      ...createInitialState(),
      activeTabId: 'visible',
      currentProjectId: 'proj-1',
      projects: [project('ws-2')],
      // The setup tab is appended last, so closing the only visible tab makes
      // it the positional fallback.
      tabs: [tab({ id: 'visible', workspaceId: 'ws-2' }), tab({ hidden: true, id: 'setup' })],
    }

    const next = appReducer(state, { tabId: 'visible', type: 'close-tab' })

    expect(next.tabs.map((t) => t.id)).toEqual(['setup'])
    expect(next.activeTabId).toBeNull()
  })
})

describe('reorder-active-tab', () => {
  test('steps over a hidden tab instead of swapping with it', () => {
    const state: AppState = {
      ...createInitialState(),
      activeTabId: 'b',
      currentProjectId: 'proj-1',
      projects: [project('ws-2')],
      tabs: [tab({ id: 'a' }), tab({ id: 'b' }), tab({ hidden: true, id: 'setup' })],
    }

    // Moving right off the last visible tab must be a no-op, not a swap that
    // shuffles the hidden tab out of its append slot.
    expect(
      appReducer(state, { delta: 1, type: 'reorder-active-tab' }).tabs.map((t) => t.id)
    ).toEqual(['a', 'b', 'setup'])
  })
})

describe('serializeProject', () => {
  test('omits hidden tabs from the snapshot', () => {
    const state: AppState = {
      ...createInitialState(),
      activeTabId: 'visible',
      tabs: [tab({ id: 'visible' }), tab({ hidden: true, id: 'setup' })],
    }

    expect(serializeProject(state).tabs.map((t) => t.id)).toEqual(['visible'])
  })
})
