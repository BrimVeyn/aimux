import { afterEach, beforeEach, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AppState, SessionRecord, TabSession, WorktreeRecord } from '../../src/state/types'

import { executeSideEffect, type SideEffectContext } from '../../src/app-runtime/side-effects'
import { enqueueGitOp } from '../../src/git/command-queue'
import { appReducer, createInitialState } from '../../src/state/store'

const NOW = '2026-05-24T00:00:00.000Z'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

let base: string
let main: string
let wt: string
let prevHome: string | undefined
let prevRoot: string | undefined

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'aimux-move-se-')))
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
  // aimux-temp worktree placed inside the sandboxed worktree root.
  wt = join(base, 'aimux-wt', 'r-test', 'feature-1')
  git(main, 'worktree', 'add', '-b', 'feature', wt)
  writeFileSync(join(wt, 'file.txt'), 'base\nfeature\n')
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  if (prevRoot === undefined) delete process.env.AIMUX_WORKTREE_ROOT
  else process.env.AIMUX_WORKTREE_ROOT = prevRoot
  rmSync(base, { force: true, recursive: true })
})

function tab(): TabSession {
  return {
    assistant: 'terminal',
    buffer: '',
    command: '',
    id: 't1',
    status: 'running',
    terminalModes: {
      alternateScrollMode: false,
      bracketedPasteMode: false,
      isAlternateBuffer: false,
      mouseTrackingMode: 'none',
      sendFocusMode: false,
    },
    title: 'term',
    worktreeId: 'wt-feat',
  }
}

test('move-worktree with deleteSource closes source tabs and removes the worktree', async () => {
  const worktrees: WorktreeRecord[] = [
    {
      createdAt: NOW,
      createdByAimux: false,
      id: 'wt-main',
      name: 'main',
      path: main,
      repoRoot: main,
      source: 'primary',
      updatedAt: NOW,
    },
    {
      branch: 'feature',
      createdAt: NOW,
      createdByAimux: true,
      id: 'wt-feat',
      name: 'feature',
      path: wt,
      repoRoot: main,
      source: 'aimux-temp',
      updatedAt: NOW,
    },
  ]
  const session: SessionRecord = {
    activeWorktreeId: 'wt-feat',
    createdAt: NOW,
    id: 's1',
    lastOpenedAt: NOW,
    name: 's1',
    updatedAt: NOW,
    worktrees,
  }
  let state: AppState = {
    ...createInitialState({}, [session]),
    currentSessionId: 's1',
    tabs: [tab()],
  }
  const disposed: string[] = []
  const ctx: SideEffectContext = {
    activeTab: undefined,
    backend: {
      disposeSession: (id: string) => {
        disposed.push(id)
      },
    } as never,
    clearIdleTimer: () => {},
    clearStartupGrace: () => {},
    dispatch: (action) => {
      state = appReducer(state, action)
    },
    getCurrentSessionProjectPath: () => {},
    getState: () => state,
    renderer: { destroy() {} } as never,
    setThemeId: () => {},
    startStartupGrace: () => {},
    state,
    themeId: 'opencode',
  }

  executeSideEffect(
    {
      deleteSource: true,
      sessionId: 's1',
      sourceWorktreeId: 'wt-feat',
      targetWorktreeId: 'wt-main',
      type: 'move-worktree',
    },
    ctx
  )
  // The move runs inside enqueueGitOp; chain after it to await completion.
  await enqueueGitOp(async () => {})

  const remaining = state.sessions[0]?.worktrees?.map((w) => w.id)
  expect(remaining).toEqual(['wt-main'])
  expect(disposed).toContain('t1')
  expect(git(main, 'worktree', 'list', '--porcelain')).not.toContain(wt)
  expect(git(main, 'diff', '--cached', '--name-only')).toContain('file.txt')
})
