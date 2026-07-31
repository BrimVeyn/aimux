import { expect, test } from 'bun:test'

import type { AppAction } from '../../src/state/actions'
import type { AppState } from '../../src/state/types'

import { executeSideEffect } from '../../src/app-runtime/side-effects'
import { appReducer, createInitialState } from '../../src/state/store'

const NOW = '2026-07-31T00:00:00.000Z'

function seed(): AppState {
  const base = createInitialState({}, [
    {
      activeWorkspaceId: 'workspace-new',
      createdAt: NOW,
      id: 'project-1',
      lastOpenedAt: NOW,
      name: 'repo',
      updatedAt: NOW,
      workspaces: [
        {
          branch: 'aimux/placeholder',
          createdAt: NOW,
          createdByAimux: true,
          id: 'workspace-new',
          name: 'Placeholder',
          path: '/tmp/aimux-wt/repo/placeholder',
          repoRoot: '/repo',
          source: 'aimux-temp',
          updatedAt: NOW,
        },
      ],
    },
  ])
  return appReducer(
    { ...base, currentProjectId: 'project-1' },
    {
      pendingWorkspace: {
        projectId: 'project-1',
        prompt: 'fix the scroll drift',
        workspaceId: 'workspace-new',
      },
      type: 'open-new-tab-modal',
    }
  )
}

/** A store that actually applies dispatches, like the real one. */
function harness(initial: AppState) {
  let state = initial
  const writes: { tabId: string; input: string }[] = []
  const started: string[] = []
  const backend = {
    createSession: (tabId: string) => void started.push(tabId),
    resizeTab: () => {},
    scrollViewportToBottom: () => {},
    write: (tabId: string, input: string) => void writes.push({ input, tabId }),
  }
  const ctx = {
    activeTab: undefined,
    backend: backend as never,
    clearIdleTimer: () => {},
    clearStartupGrace: () => {},
    dispatch: (action: AppAction) => {
      state = appReducer(state, action)
    },
    getCurrentProjectProjectPath: (): string | undefined => undefined,
    getState: () => state,
    renderer: { destroy() {} } as never,
    setThemeId: () => {},
    startStartupGrace: () => {},
    get state() {
      return state
    },
    themeId: 'opencode' as const,
  }
  return { ctx, started, writes }
}

test('the chained launch pins the tab to the new workspace and sends the prompt', async () => {
  const { ctx, writes } = harness(seed())

  executeSideEffect({ type: 'launch-selected-assistant' }, ctx)

  const tab = ctx.getState().tabs[0]
  if (!tab) throw new Error('expected the launch to create a tab')
  expect(tab.workspaceId).toBe('workspace-new')

  // The assistant enables bracketed paste and echoes what it was handed.
  ctx.dispatch({
    source: 'data',
    tabId: tab.id,
    terminalModes: { ...tab.terminalModes, bracketedPasteMode: true },
    type: 'replace-tab-viewport',
    viewport: {
      baseY: 0,
      cursorVisible: true,
      lines: [{ spans: [{ text: '> fix the scroll drift' }] }],
      viewportY: 0,
    },
  })

  await Bun.sleep(1200)

  const sent = writes.map((entry) => entry.input).join('')
  expect(sent).toContain('fix the scroll drift')
  expect(writes.at(-1)?.input).toBe('\r')
  expect(writes.every((entry) => entry.tabId === tab.id)).toBe(true)
})

test('a plain new tab sends nothing', async () => {
  const base = createInitialState({}, [])
  const { ctx, writes } = harness(appReducer(base, { type: 'open-new-tab-modal' }))

  executeSideEffect({ type: 'launch-selected-assistant' }, ctx)
  await Bun.sleep(300)

  expect(writes).toEqual([])
})

test('<C-n> asks for a workspace while the project sits on its primary checkout', () => {
  const base = seed()
  const project = base.projects[0]
  if (!project) throw new Error('expected a seeded project')
  const onPrimary: AppState = {
    ...base,
    modal: { cursorPos: 0, editBuffer: null, projectTargetId: null, selectedIndex: 0, type: null },
    projects: [
      {
        ...project,
        activeWorkspaceId: 'workspace-primary',
        workspaces: [
          {
            createdAt: NOW,
            createdByAimux: false,
            id: 'workspace-primary',
            name: 'repo',
            path: '/repo',
            repoRoot: '/repo',
            source: 'primary',
            updatedAt: NOW,
          },
        ],
      },
    ],
  }
  const { ctx } = harness(onPrimary)

  executeSideEffect({ type: 'open-new-tab' }, ctx)

  // No new-tab picker: tabs live in workspaces, so the ask is redirected to
  // the one thing that would make a tab possible.
  expect(ctx.getState().modal.type).toBe('create-workspace')
})

test('<C-n> opens the picker once a real workspace is active', () => {
  const { ctx } = harness({
    ...seed(),
    modal: { cursorPos: 0, editBuffer: null, projectTargetId: null, selectedIndex: 0, type: null },
  })

  executeSideEffect({ type: 'open-new-tab' }, ctx)

  expect(ctx.getState().modal.type).toBe('new-tab')
})
