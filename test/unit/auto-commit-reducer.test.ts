import { expect, test } from 'bun:test'

import type { AppAction, AutoCommitState } from '../../src/state/types'

import { reduceAutoCommitState } from '../../src/state/reducers/auto-commit-state'

const SESSION = 's1'
const TAB = 't1'
const HASH = 'h-aaa'

function empty(): AutoCommitState {
  return { bySession: {} }
}

function expectNonNull<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected non-null value')
  return value
}

test('idle → generating on generation-started', () => {
  const ctrl = new AbortController()
  const next = reduceAutoCommitState(empty(), {
    abortController: ctrl,
    sessionId: SESSION,
    startedAt: 1000,
    tabId: TAB,
    type: 'auto-commit-generation-started',
    workingTreeHash: HASH,
  } as AppAction)
  expect(expectNonNull(next).bySession[SESSION]).toEqual({
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
      sessionId: SESSION,
      startedAt: 1000,
      tabId: TAB,
      type: 'auto-commit-generation-started',
      workingTreeHash: HASH,
    } as AppAction)
  )
  const ready = reduceAutoCommitState(start, {
    body: 'y',
    generatedAt: 2000,
    sessionId: SESSION,
    title: 'feat: x',
    type: 'auto-commit-generation-ready',
    workingTreeHash: HASH,
  } as AppAction)
  expect(expectNonNull(ready).bySession[SESSION]).toMatchObject({
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
      sessionId: SESSION,
      startedAt: 1000,
      tabId: TAB,
      type: 'auto-commit-generation-started',
      workingTreeHash: HASH,
    } as AppAction)
  )
  const ignored = reduceAutoCommitState(start, {
    body: '',
    generatedAt: 2000,
    sessionId: SESSION,
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
      sessionId: SESSION,
      startedAt: 1000,
      tabId: TAB,
      type: 'auto-commit-generation-started',
      workingTreeHash: HASH,
    } as AppAction)
  )
  const cleared = expectNonNull(
    reduceAutoCommitState(start, {
      sessionId: SESSION,
      type: 'auto-commit-clear',
    } as AppAction)
  )
  expect(cleared.bySession[SESSION]).toEqual({ kind: 'idle' })
  expect(ctrl.signal.aborted).toBe(true)
})

test('clear on idle is a no-op', () => {
  const next = reduceAutoCommitState(empty(), {
    sessionId: SESSION,
    type: 'auto-commit-clear',
  } as AppAction)
  expect(next).toBeNull()
})

test('ready state survives an unrelated action', () => {
  const state: AutoCommitState = {
    bySession: {
      [SESSION]: {
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

test('dismiss on ready keeps the suggestion and marks it dismissed', () => {
  const state: AutoCommitState = {
    bySession: {
      [SESSION]: {
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
      sessionId: SESSION,
      type: 'auto-commit-dismiss',
    } as AppAction)
  )
  expect(next.bySession[SESSION]).toEqual({
    body: 'b',
    dismissed: true,
    generatedAt: 1,
    kind: 'ready',
    tabId: TAB,
    title: 't',
    workingTreeHash: HASH,
  })
})

test('dismiss on already-dismissed ready is a no-op', () => {
  const state: AutoCommitState = {
    bySession: {
      [SESSION]: {
        body: 'b',
        dismissed: true,
        generatedAt: 1,
        kind: 'ready',
        tabId: TAB,
        title: 't',
        workingTreeHash: HASH,
      },
    },
  }
  const next = reduceAutoCommitState(state, {
    sessionId: SESSION,
    type: 'auto-commit-dismiss',
  } as AppAction)
  expect(next).toBeNull()
})

test('dismiss on generating aborts and goes idle', () => {
  const ctrl = new AbortController()
  const state: AutoCommitState = {
    bySession: {
      [SESSION]: {
        abortController: ctrl,
        kind: 'generating',
        startedAt: 0,
        tabId: TAB,
        workingTreeHash: HASH,
      },
    },
  }
  const next = expectNonNull(
    reduceAutoCommitState(state, {
      sessionId: SESSION,
      type: 'auto-commit-dismiss',
    } as AppAction)
  )
  expect(next.bySession[SESSION]).toEqual({ kind: 'idle' })
  expect(ctrl.signal.aborted).toBe(true)
})

test('accept on dismissed ready still goes idle and clears', () => {
  const state: AutoCommitState = {
    bySession: {
      [SESSION]: {
        body: 'b',
        dismissed: true,
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
      sessionId: SESSION,
      type: 'auto-commit-accept',
    } as AppAction)
  )
  expect(next.bySession[SESSION]).toEqual({ kind: 'idle' })
})
