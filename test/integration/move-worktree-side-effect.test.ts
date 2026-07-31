import { afterEach, beforeEach, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AppState, ProjectRecord, TabSession, WorktreeRecord } from '../../src/state/types'

import { executeSideEffect, type SideEffectContext } from '../../src/app-runtime/side-effects'
import { enqueueGitOp } from '../../src/git/command-queue'
import { appReducer, createInitialState } from '../../src/state/store'

const NOW = '2026-05-24T00:00:00.000Z'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

let base: string
let main: string
let src: string
let tgt: string
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
  // Two aimux-temp worktrees inside the sandboxed root: source + target.
  src = join(base, 'aimux-wt', 'r-test', 'src-1')
  tgt = join(base, 'aimux-wt', 'r-test', 'tgt-1')
  git(main, 'worktree', 'add', '-b', 'feature', src)
  git(main, 'worktree', 'add', '-b', 'target-branch', tgt)
  writeFileSync(join(src, 'file.txt'), 'base\nfeature\n')
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  if (prevRoot === undefined) delete process.env.AIMUX_WORKTREE_ROOT
  else process.env.AIMUX_WORKTREE_ROOT = prevRoot
  rmSync(base, { force: true, recursive: true })
})

function tab(id: string, worktreeId: string): TabSession {
  return {
    assistant: 'terminal',
    buffer: '',
    command: '',
    id,
    status: 'running',
    terminalModes: {
      alternateScrollMode: false,
      bracketedPasteMode: false,
      isAlternateBuffer: false,
      mouseTrackingMode: 'none',
      sendFocusMode: false,
    },
    title: id,
    worktreeId,
  }
}

function tempWorktree(over: Partial<WorktreeRecord> & Pick<WorktreeRecord, 'id' | 'path'>) {
  return {
    branch: 'b',
    createdAt: NOW,
    createdByAimux: true,
    name: over.id,
    repoRoot: main,
    source: 'aimux-temp' as const,
    updatedAt: NOW,
    ...over,
  } satisfies WorktreeRecord
}

test('move + delete leaves the target active (not snapped back to a default worktree)', async () => {
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
    tempWorktree({ branch: 'feature', id: 'wt-src', path: src }),
    tempWorktree({ branch: 'target-branch', id: 'wt-tgt', path: tgt }),
  ]
  const project: ProjectRecord = {
    activeWorktreeId: 'wt-src',
    createdAt: NOW,
    id: 's1',
    lastOpenedAt: NOW,
    name: 's1',
    updatedAt: NOW,
    worktrees,
  }
  // A tab in the primary worktree is what the source tab would reselect to on
  // close — the bug snapped the active worktree there instead of the target.
  let state: AppState = {
    ...createInitialState({}, [project]),
    activeTabId: 't-src',
    currentProjectId: 's1',
    tabs: [tab('t-main', 'wt-main'), tab('t-src', 'wt-src')],
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
    getCurrentProjectProjectPath: () => {},
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
      projectId: 's1',
      sourceWorktreeId: 'wt-src',
      targetWorktreeId: 'wt-tgt',
      type: 'move-worktree',
    },
    ctx
  )
  await enqueueGitOp(async () => {})

  const after = state.projects[0]
  // The target is the active worktree — not the primary the closed tab pointed at.
  expect(after?.activeWorktreeId).toBe('wt-tgt')
  expect(after?.worktrees?.map((w) => w.id)).toEqual(['wt-main', 'wt-tgt'])
  expect(disposed).toContain('t-src')
  expect(git(tgt, 'diff', '--cached', '--name-only')).toContain('file.txt')
})

function harness() {
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
    tempWorktree({ branch: 'feature', id: 'wt-src', path: src }),
    tempWorktree({ branch: 'target-branch', id: 'wt-tgt', path: tgt }),
  ]
  const project: ProjectRecord = {
    activeWorktreeId: 'wt-src',
    createdAt: NOW,
    id: 's1',
    lastOpenedAt: NOW,
    name: 's1',
    updatedAt: NOW,
    worktrees,
  }
  let state: AppState = {
    ...createInitialState({}, [project]),
    activeTabId: 't-src',
    currentProjectId: 's1',
    tabs: [tab('t-main', 'wt-main'), tab('t-src', 'wt-src')],
  }
  const ctx: SideEffectContext = {
    activeTab: undefined,
    backend: { disposeSession: () => {} } as never,
    clearIdleTimer: () => {},
    clearStartupGrace: () => {},
    dispatch: (action) => {
      state = appReducer(state, action)
    },
    getCurrentProjectProjectPath: () => {},
    getState: () => state,
    renderer: { destroy() {} } as never,
    setThemeId: () => {},
    startStartupGrace: () => {},
    state,
    themeId: 'opencode',
  }
  return { ctx, getState: () => state }
}

test('overlapping dirty target opens the stash dialog; retry with stashTarget completes', async () => {
  // Target edit overlaps the source change to file.txt.
  writeFileSync(join(tgt, 'file.txt'), 'base\nlocal target edit\n')
  const { ctx, getState } = harness()

  executeSideEffect(
    {
      projectId: 's1',
      sourceWorktreeId: 'wt-src',
      targetWorktreeId: 'wt-tgt',
      type: 'move-worktree',
    },
    ctx
  )
  await enqueueGitOp(async () => {})

  const modal = getState().modal
  expect(modal.type).toBe('worktree-move-confirm')
  if (modal.type !== 'worktree-move-confirm') return
  expect(modal.variant).toBe('stash-target')
  expect(modal.files).toContain('file.txt')
  expect(modal.sourceWorktreeId).toBe('wt-src')
  expect(modal.targetWorktreeId).toBe('wt-tgt')
  // Nothing was touched on the first attempt.
  expect(git(tgt, 'stash', 'list').trim()).toBe('')

  executeSideEffect(
    {
      projectId: 's1',
      sourceWorktreeId: 'wt-src',
      stashTarget: true,
      targetWorktreeId: 'wt-tgt',
      type: 'move-worktree',
    },
    ctx
  )
  await enqueueGitOp(async () => {})

  expect(git(tgt, 'stash', 'list')).toContain('aimux: backup before move from feature')
  expect(git(tgt, 'diff', '--cached', '--name-only')).toContain('file.txt')
  expect(getState().projects[0]?.activeWorktreeId).toBe('wt-tgt')
})

test('conflict opens the keep-conflicts dialog; retry leaves markers and keeps the source', async () => {
  // Diverge the target with a conflicting commit (target stays clean).
  writeFileSync(join(tgt, 'file.txt'), 'base\nfrom-target\n')
  git(tgt, 'config', 'user.email', 't@e.com')
  git(tgt, 'config', 'user.name', 'T')
  git(tgt, 'commit', '-am', 'target change')
  const { ctx, getState } = harness()

  executeSideEffect(
    {
      projectId: 's1',
      sourceWorktreeId: 'wt-src',
      targetWorktreeId: 'wt-tgt',
      type: 'move-worktree',
    },
    ctx
  )
  await enqueueGitOp(async () => {})

  const modal = getState().modal
  expect(modal.type).toBe('worktree-move-confirm')
  if (modal.type !== 'worktree-move-confirm') return
  expect(modal.variant).toBe('keep-conflicts')
  expect(modal.files).toContain('file.txt')
  // First attempt fully restored the target.
  expect(git(tgt, 'status', '--porcelain').trim()).toBe('')

  executeSideEffect(
    {
      deleteSource: true,
      keepConflicts: true,
      projectId: 's1',
      sourceWorktreeId: 'wt-src',
      targetWorktreeId: 'wt-tgt',
      type: 'move-worktree',
    },
    ctx
  )
  await enqueueGitOp(async () => {})

  // Conflict markers left in the target for manual resolution.
  expect(git(tgt, 'diff', '--name-only', '--diff-filter=U')).toContain('file.txt')
  const after = getState().projects[0]
  expect(after?.activeWorktreeId).toBe('wt-tgt')
  // deleteSource is deliberately ignored: the source's work only landed half-resolved.
  expect(after?.worktrees?.map((w) => w.id)).toContain('wt-src')
})
