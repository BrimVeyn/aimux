import { expect, test } from 'bun:test'

import type { AppAction, AutoCommitState } from '../../src/state/types'

import { reduceAutoCommitState } from '../../src/state/reducers/auto-commit-state'

const PROJECT = 's1'
const TAB = 't1'
const HASH = 'h-aaa'

function empty(): AutoCommitState {
  return { byProject: {} }
}

function expectNonNull<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected non-null value')
  return value
}

test('idle → generating on generation-started', () => {
  const ctrl = new AbortController()
  const next = reduceAutoCommitState(empty(), {
    abortController: ctrl,
    projectId: PROJECT,
    startedAt: 1000,
    tabId: TAB,
    type: 'auto-commit-generation-started',
    workingTreeHash: HASH,
  } as AppAction)
  expect(expectNonNull(next).byProject[PROJECT]).toEqual({
    abortController: ctrl,
    kind: 'generating',
    startedAt: 1000,
    tabId: TAB,
    workingTreeHash: HASH,
  })
})

test('generation-ready with matching hash → ready', () => {
  const ctrl = new AbortController()
  const start = expectNonNull(
    reduceAutoCommitState(empty(), {
      abortController: ctrl,
      projectId: PROJECT,
      startedAt: 1000,
      tabId: TAB,
      type: 'auto-commit-generation-started',
      workingTreeHash: HASH,
    } as AppAction)
  )
  const ready = reduceAutoCommitState(start, {
    body: 'y',
    generatedAt: 2000,
    projectId: PROJECT,
    title: 'feat: x',
    type: 'auto-commit-generation-ready',
    workingTreeHash: HASH,
  } as AppAction)
  expect(expectNonNull(ready).byProject[PROJECT]).toMatchObject({
    body: 'y',
    generatedAt: 2000,
    kind: 'ready',
    tabId: TAB,
    title: 'feat: x',
    workingTreeHash: HASH,
  })
})

test('generation-ready with stale hash is ignored', () => {
  const ctrl = new AbortController()
  const start = expectNonNull(
    reduceAutoCommitState(empty(), {
      abortController: ctrl,
      projectId: PROJECT,
      startedAt: 1000,
      tabId: TAB,
      type: 'auto-commit-generation-started',
      workingTreeHash: HASH,
    } as AppAction)
  )
  const ignored = reduceAutoCommitState(start, {
    body: '',
    generatedAt: 2000,
    projectId: PROJECT,
    title: 'stale',
    type: 'auto-commit-generation-ready',
    workingTreeHash: 'h-OTHER',
  } as AppAction)
  expect(ignored).toBeNull()
})

test('clear aborts the controller when generating', () => {
  const ctrl = new AbortController()
  const start = expectNonNull(
    reduceAutoCommitState(empty(), {
      abortController: ctrl,
      projectId: PROJECT,
      startedAt: 1000,
      tabId: TAB,
      type: 'auto-commit-generation-started',
      workingTreeHash: HASH,
    } as AppAction)
  )
  const cleared = expectNonNull(
    reduceAutoCommitState(start, {
      projectId: PROJECT,
      type: 'auto-commit-clear',
    } as AppAction)
  )
  expect(cleared.byProject[PROJECT]).toEqual({ kind: 'idle' })
  expect(ctrl.signal.aborted).toBe(true)
})

test('clear on idle is a no-op', () => {
  const next = reduceAutoCommitState(empty(), {
    projectId: PROJECT,
    type: 'auto-commit-clear',
  } as AppAction)
  expect(next).toBeNull()
})

test('ready state survives an unrelated action', () => {
  const state: AutoCommitState = {
    byProject: {
      [PROJECT]: {
        body: '',
        generatedAt: 1,
        kind: 'ready',
        tabId: TAB,
        title: 't',
        workingTreeHash: HASH,
      },
    },
  }
  const next = reduceAutoCommitState(state, { type: 'close-modal' } as AppAction)
  expect(next).toBeNull()
})

test('clear on ready goes idle', () => {
  const state: AutoCommitState = {
    byProject: {
      [PROJECT]: {
        body: 'b',
        generatedAt: 1,
        kind: 'ready',
        tabId: TAB,
        title: 't',
        workingTreeHash: HASH,
      },
    },
  }
  const next = expectNonNull(
    reduceAutoCommitState(state, {
      projectId: PROJECT,
      type: 'auto-commit-clear',
    } as AppAction)
  )
  expect(next.byProject[PROJECT]).toEqual({ kind: 'idle' })
})
