import { afterEach, beforeEach, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SideEffectContext } from '../../src/app-runtime/side-effect-context'
import type { AppAction } from '../../src/state/actions'
import type { AppState, ProjectRecord } from '../../src/state/types'

import { executeSideEffect } from '../../src/app-runtime/side-effects'
import { enqueueGitOp } from '../../src/git/command-queue'
import { appReducer, createInitialState } from '../../src/state/store'

const NOW = '2026-08-03T00:00:00.000Z'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

let base: string
let main: string
let prevHome: string | undefined
let prevRoot: string | undefined

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'aimux-create-ws-')))
  prevHome = process.env.HOME
  prevRoot = process.env.AIMUX_WORKTREE_ROOT
  process.env.HOME = join(base, 'home')
  process.env.AIMUX_WORKTREE_ROOT = join(base, 'aimux-wt')
  main = join(base, 'main')
  execFileSync('git', ['init', main], { stdio: 'ignore' })
  git(main, 'config', 'user.email', 't@e.com')
  git(main, 'config', 'user.name', 'T')
  writeFileSync(join(main, 'file.txt'), 'base\n')
  git(main, 'add', '-A')
  git(main, 'commit', '-m', 'init')
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  if (prevRoot === undefined) delete process.env.AIMUX_WORKTREE_ROOT
  else process.env.AIMUX_WORKTREE_ROOT = prevRoot
  rmSync(base, { force: true, recursive: true })
})

function harness() {
  const project: ProjectRecord = {
    activeWorkspaceId: 'wt-main',
    createdAt: NOW,
    id: 'p1',
    lastOpenedAt: NOW,
    name: 'repo',
    updatedAt: NOW,
    workspaces: [
      {
        createdAt: NOW,
        createdByAimux: false,
        id: 'wt-main',
        name: 'repo',
        path: main,
        repoRoot: main,
        source: 'primary',
        updatedAt: NOW,
      },
    ],
  }
  let state: AppState = {
    ...createInitialState({}, [project]),
    currentProjectId: 'p1',
    modal: {
      activeField: 'prompt',
      baseBranches: [],
      baseQuery: '',
      baseRef: '',
      branchError: null,
      cursorPos: 0,
      editBuffer: '',
      projectTargetId: null,
      prompt: 'fix the scroll drift',
      selectedIndex: 0,
      type: 'create-workspace',
    },
  }
  const ctx: SideEffectContext = {
    activeTab: undefined,
    backend: { disposeSession: () => {} } as never,
    clearIdleTimer: () => {},
    clearStartupGrace: () => {},
    dispatch: (action: AppAction) => {
      state = appReducer(state, action)
    },
    getCurrentProjectProjectPath: () => main,
    getState: () => state,
    renderer: { destroy() {} } as never,
    setThemeId: () => {},
    startStartupGrace: () => {},
    get state() {
      return state
    },
    themeId: 'opencode',
  }
  return { ctx, getState: () => state }
}

test('the assistant picker opens before git has cut the worktree', async () => {
  const { ctx, getState } = harness()

  executeSideEffect({ type: 'create-workspace' }, ctx)

  // The whole point: no await between `Enter` and the next modal. `git fetch` +
  // `worktree add` take seconds, and this used to sit on both of them.
  const modal = getState().modal
  expect(modal.type).toBe('new-tab')
  if (modal.type !== 'new-tab') return
  const pending = modal.pendingWorkspace
  expect(pending?.prompt).toBe('fix the scroll drift')
  // Still only the primary: the worktree is being cut in the background.
  expect(getState().projects[0]?.workspaces).toHaveLength(1)

  await enqueueGitOp(async () => {})

  const workspaces = getState().projects[0]?.workspaces ?? []
  expect(workspaces).toHaveLength(2)
  const created = workspaces.find((entry) => entry.id === pending?.workspaceId)
  // The id the picker pinned its tab to is the one git ended up creating.
  if (!created) throw new Error('the pending workspace id never materialized')
  expect(existsSync(created.path)).toBe(true)
  expect(git(created.path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(created.branch ?? '')
})
