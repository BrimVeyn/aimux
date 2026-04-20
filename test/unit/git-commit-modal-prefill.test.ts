import { expect, test } from 'bun:test'

import type { AppAction, AppState, AutoCommitState } from '../../src/state/types'

import { reduceModalState } from '../../src/state/reducers/modal-state'
import { createInitialState } from '../../src/state/store'

const SESSION = 's1'
const HASH = 'h1'

function stateWithReadySuggestion(title: string, body: string): AppState {
  const base = createInitialState()
  const autoCommit: AutoCommitState = {
    bySession: {
      [SESSION]: {
        body,
        generatedAt: 1,
        kind: 'ready',
        tabId: 't1',
        title,
        workingTreeHash: HASH,
      },
    },
  }
  return { ...base, autoCommit, currentSessionId: SESSION }
}

test('open-git-commit-modal pre-fills from a ready suggestion', () => {
  const state = stateWithReadySuggestion('feat: add thing', 'body text')
  const next = reduceModalState(state, {
    sessionId: SESSION,
    type: 'open-git-commit-modal',
  } as AppAction)
  expect(next).not.toBeNull()
  const n = next as AppState
  if (n.modal.type !== 'git-commit') throw new Error('expected git-commit modal')
  expect(n.focusMode).toBe('command-edit')
  expect(n.modal.activeField).toBe('title')
  expect(n.modal.editBuffer).toBe('feat: add thing')
  expect(n.modal.contentBuffer).toBe('body text')
  expect(n.modal.cursorPos).toBe('feat: add thing'.length)
  expect(n.modal.stage).toBe('edit')
})

test('open-git-commit-modal falls back to empty when no ready suggestion exists', () => {
  const base = createInitialState()
  const next = reduceModalState(base, {
    sessionId: SESSION,
    type: 'open-git-commit-modal',
  } as AppAction)
  expect(next).not.toBeNull()
  const n = next as AppState
  if (n.modal.type !== 'git-commit') throw new Error('expected git-commit modal')
  expect(n.modal.editBuffer).toBe('')
  expect(n.modal.contentBuffer).toBe('')
  expect(n.modal.cursorPos).toBe(0)
  expect(n.modal.stage).toBe('edit')
})

test('open-git-commit-modal without sessionId opens empty', () => {
  const state = stateWithReadySuggestion('feat: x', 'b')
  const next = reduceModalState(state, { type: 'open-git-commit-modal' } as AppAction)
  const n = next as AppState
  if (n.modal.type !== 'git-commit') throw new Error('expected git-commit modal')
  expect(n.modal.editBuffer).toBe('')
  expect(n.modal.contentBuffer).toBe('')
})

test('git-commit-enter-confirm flips stage to confirm', () => {
  const state = stateWithReadySuggestion('t', 'b')
  const opened = reduceModalState(state, {
    sessionId: SESSION,
    type: 'open-git-commit-modal',
  } as AppAction) as AppState
  const next = reduceModalState(opened, { type: 'git-commit-enter-confirm' } as AppAction)
  const n = next as AppState
  if (n.modal.type !== 'git-commit') throw new Error('expected git-commit modal')
  expect(n.modal.stage).toBe('confirm')
})

test('git-commit-leave-confirm flips stage back to edit', () => {
  const state = stateWithReadySuggestion('t', 'b')
  const opened = reduceModalState(state, {
    sessionId: SESSION,
    type: 'open-git-commit-modal',
  } as AppAction) as AppState
  const confirm = reduceModalState(opened, {
    type: 'git-commit-enter-confirm',
  } as AppAction) as AppState
  const back = reduceModalState(confirm, {
    type: 'git-commit-leave-confirm',
  } as AppAction) as AppState
  if (back.modal.type !== 'git-commit') throw new Error('expected git-commit modal')
  expect(back.modal.stage).toBe('edit')
})

test('git-commit-enter-generating flips stage to generating', () => {
  const state = stateWithReadySuggestion('t', 'b')
  const opened = reduceModalState(state, {
    sessionId: SESSION,
    type: 'open-git-commit-modal',
  } as AppAction) as AppState
  const next = reduceModalState(opened, {
    sessionId: SESSION,
    type: 'git-commit-enter-generating',
  } as AppAction) as AppState
  if (next.modal.type !== 'git-commit') throw new Error('expected git-commit modal')
  expect(next.modal.stage).toBe('generating')
  expect(next.modal.sessionTargetId).toBe(SESSION)
  expect(next.focusMode).toBe('modal')
})

test('auto-commit-generation-ready while generating fills fields and enters confirm', () => {
  const base = createInitialState()
  const opened = reduceModalState(base, {
    sessionId: SESSION,
    type: 'open-git-commit-modal',
  } as AppAction) as AppState
  const generating = reduceModalState(opened, {
    sessionId: SESSION,
    type: 'git-commit-enter-generating',
  } as AppAction) as AppState
  const withInFlight = {
    ...generating,
    autoCommit: {
      bySession: {
        [SESSION]: {
          abortController: new AbortController(),
          kind: 'generating' as const,
          startedAt: 0,
          tabId: 't1',
          workingTreeHash: HASH,
        },
      },
    },
  }
  const ready = reduceModalState(withInFlight, {
    body: 'generated body',
    generatedAt: 123,
    sessionId: SESSION,
    title: 'generated title',
    type: 'auto-commit-generation-ready',
    workingTreeHash: HASH,
  } as AppAction) as AppState
  if (ready.modal.type !== 'git-commit') throw new Error('expected git-commit modal')
  expect(ready.modal.stage).toBe('confirm')
  expect(ready.modal.editBuffer).toBe('generated title')
  expect(ready.modal.contentBuffer).toBe('generated body')
  expect(ready.modal.activeField).toBe('title')
})

test('auto-commit-clear while generating reverts to edit stage', () => {
  const base = createInitialState()
  const opened = reduceModalState(base, {
    sessionId: SESSION,
    type: 'open-git-commit-modal',
  } as AppAction) as AppState
  const generating = reduceModalState(opened, {
    sessionId: SESSION,
    type: 'git-commit-enter-generating',
  } as AppAction) as AppState
  const cleared = reduceModalState(generating, {
    sessionId: SESSION,
    type: 'auto-commit-clear',
  } as AppAction) as AppState
  if (cleared.modal.type !== 'git-commit') throw new Error('expected git-commit modal')
  expect(cleared.modal.stage).toBe('edit')
})

test('auto-commit-generation-ready for a different session does not touch the modal', () => {
  const base = createInitialState()
  const opened = reduceModalState(base, {
    sessionId: SESSION,
    type: 'open-git-commit-modal',
  } as AppAction) as AppState
  const generating = reduceModalState(opened, {
    sessionId: SESSION,
    type: 'git-commit-enter-generating',
  } as AppAction) as AppState
  const result = reduceModalState(generating, {
    body: 'x',
    generatedAt: 1,
    sessionId: 'other-session',
    title: 'x',
    type: 'auto-commit-generation-ready',
    workingTreeHash: 'h',
  } as AppAction)
  expect(result).toBeNull()
})

test('switch-create-session-field swaps buffers on the git-commit modal', () => {
  const state = stateWithReadySuggestion('feat: x', 'body text')
  const opened = reduceModalState(state, {
    sessionId: SESSION,
    type: 'open-git-commit-modal',
  } as AppAction) as AppState
  const switched = reduceModalState(opened, {
    type: 'switch-create-session-field',
  } as AppAction) as AppState
  if (switched.modal.type !== 'git-commit') throw new Error('expected git-commit modal')
  expect(switched.modal.activeField).toBe('body')
  expect(switched.modal.editBuffer).toBe('body text')
  expect(switched.modal.contentBuffer).toBe('feat: x')
})
