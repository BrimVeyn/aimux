import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AppAction } from '../../src/state/actions'
import type { ProjectRecord, TabSession } from '../../src/state/types'

import { recordSetupExit } from '../../src/app-runtime/setup-actions'
import { appStore } from '../../src/state/app-store'

const NOW = '2026-08-01T00:00:00.000Z'
const originalHome = process.env.HOME
const dirs: string[] = []

/**
 * `recordSetupExit` persists through `saveProjectCatalog`, which writes under
 * `$HOME`. Redirect it so the test cannot touch the real catalog.
 */
function withHome(): void {
  const dir = mkdtempSync(join(tmpdir(), 'aimux-setup-exit-'))
  dirs.push(dir)
  process.env.HOME = dir
}

afterEach(() => {
  process.env.HOME = originalHome
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function project(): ProjectRecord {
  return {
    createdAt: NOW,
    id: 'proj-1',
    lastOpenedAt: NOW,
    name: 'repo',
    updatedAt: NOW,
    workspaces: [
      {
        createdAt: NOW,
        createdByAimux: true,
        id: 'ws-1',
        name: 'scroll drift',
        path: '/tmp/wt/scroll-drift',
        repoRoot: '/repo',
        source: 'aimux-temp',
        updatedAt: NOW,
      },
    ],
  }
}

function setupTab(overrides: Partial<TabSession>): TabSession {
  return {
    assistant: 'terminal',
    buffer: '',
    command: 'bash /home/u/.config/aimux/default/projects/proj-1/setup.sh',
    hidden: true,
    id: 'tab-setup',
    role: 'setup',
    status: 'running',
    terminalModes: {
      alternateScrollMode: false,
      bracketedPasteMode: false,
      isAlternateBuffer: false,
      mouseTrackingMode: 'none',
      sendFocusMode: false,
    },
    title: 'Setup',
    workspaceId: 'ws-1',
    ...overrides,
  }
}

function seed(tab: TabSession): AppAction[] {
  withHome()
  appStore.setState({ ...appStore.getState(), projects: [project()], tabs: [tab] })
  return []
}

test('a hidden setup tab survives its exit and stamps the workspace', () => {
  const actions = seed(setupTab({}))

  const handled = recordSetupExit('tab-setup', 1, (action) => void actions.push(action))

  // `true` is the caller's signal not to dispatch `close-tab`.
  expect(handled).toBe(true)
  expect(actions).toHaveLength(1)
  expect(actions[0]).toMatchObject({
    patch: { setupExitCode: 1 },
    projectId: 'proj-1',
    type: 'update-workspace-record',
    workspaceId: 'ws-1',
  })
})

test('a promoted setup tab survives its exit without overwriting the result', () => {
  // ↗ clears `hidden`. Before `role` existed this tab was indistinguishable from
  // an ordinary one, so its exit closed it — losing the stack trace the user
  // promoted it to read.
  const actions = seed(setupTab({ hidden: false }))

  expect(recordSetupExit('tab-setup', 1, (action) => void actions.push(action))).toBe(true)
  // The widget-owned run is the only writer, so a re-run's result stands.
  expect(actions).toEqual([])
})

test('an ordinary tab is left to the normal close path', () => {
  const actions = seed(setupTab({ hidden: false, role: undefined }))

  expect(recordSetupExit('tab-setup', 0, (action) => void actions.push(action))).toBe(false)
  expect(actions).toEqual([])
})
