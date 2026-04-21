import { expect, test } from 'bun:test'

import type { AppAction, AutoCommitState, GitRefreshPayload } from '../../src/state/types'

import { workingTreeHash } from '../../src/auto-commit/working-tree-hash'
import { reduceAutoCommitState } from '../../src/state/reducers/auto-commit-state'

const SESSION = 's1'
const TAB = 't1'

function expectNonNull<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected non-null value')
  return value
}

test('generating → ready → invalidated by diff change', () => {
  const gitBefore: GitRefreshPayload = {
    ahead: 0,
    behind: 0,
    branch: 'main',
    files: [{ added: 1, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' }],
  }
  const gitAfter: GitRefreshPayload = {
    ahead: 0,
    behind: 0,
    branch: 'main',
    files: [{ added: 5, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' }],
  }
  const h1 = workingTreeHash(gitBefore)
  const h2 = workingTreeHash(gitAfter)
  expect(h1).not.toBe(h2)

  let state: AutoCommitState = { bySession: {} }
  const ctrl = new AbortController()
  state = expectNonNull(
    reduceAutoCommitState(state, {
      abortController: ctrl,
      sessionId: SESSION,
      startedAt: 1,
      tabId: TAB,
      type: 'auto-commit-generation-started',
      workingTreeHash: h1,
    } as AppAction)
  )

  state = expectNonNull(
    reduceAutoCommitState(state, {
      body: '',
      generatedAt: 2,
      sessionId: SESSION,
      title: 'feat',
      type: 'auto-commit-generation-ready',
      workingTreeHash: h1,
    } as AppAction)
  )
  expect(state.bySession[SESSION]?.kind).toBe('ready')

  const current = state.bySession[SESSION]
  if (current?.kind === 'ready' && h2 !== current.workingTreeHash) {
    state = expectNonNull(
      reduceAutoCommitState(state, {
        sessionId: SESSION,
        type: 'auto-commit-clear',
      } as AppAction)
    )
  }
  expect(state.bySession[SESSION]).toEqual({ kind: 'idle' })
})

test('late-arriving generation-ready with stale hash is dropped', () => {
  const git: GitRefreshPayload = {
    ahead: 0,
    behind: 0,
    branch: 'main',
    files: [{ added: 1, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' }],
  }
  const h1 = workingTreeHash(git)
  let state: AutoCommitState = { bySession: {} }
  const ctrl = new AbortController()
  state = expectNonNull(
    reduceAutoCommitState(state, {
      abortController: ctrl,
      sessionId: SESSION,
      startedAt: 1,
      tabId: TAB,
      type: 'auto-commit-generation-started',
      workingTreeHash: h1,
    } as AppAction)
  )

  state = expectNonNull(
    reduceAutoCommitState(state, {
      sessionId: SESSION,
      type: 'auto-commit-clear',
    } as AppAction)
  )

  const next = reduceAutoCommitState(state, {
    body: '',
    generatedAt: 3,
    sessionId: SESSION,
    title: 'stale',
    type: 'auto-commit-generation-ready',
    workingTreeHash: h1,
  } as AppAction)
  expect(next).toBeNull()
})
