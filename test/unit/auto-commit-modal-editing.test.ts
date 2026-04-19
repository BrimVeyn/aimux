import { expect, test } from 'bun:test'

import type { AppAction, AppState, AutoCommitState } from '../../src/state/types'

import { reduceModalState } from '../../src/state/reducers/modal-state'
import { createInitialState } from '../../src/state/store'

const SESSION = 's1'
const HASH = 'h1'

function seededState(title: string, body: string): AppState {
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
  return { ...base, autoCommit }
}

test('open-auto-commit-modal seeds edit buffers with the AI suggestion', () => {
  const state = seededState('feat: x', 'body text')
  const next = reduceModalState(state, {
    sessionId: SESSION,
    type: 'open-auto-commit-modal',
  } as AppAction)
  expect(next).not.toBeNull()
  const n = next as AppState
  expect(n.focusMode).toBe('modal')
  if (n.modal.type !== 'auto-commit') throw new Error('expected auto-commit modal')
  expect(n.modal.activeField).toBe('title')
  expect(n.modal.editBuffer).toBe('feat: x')
  expect(n.modal.contentBuffer).toBe('body text')
  expect(n.modal.cursorPos).toBe('feat: x'.length)
  expect(n.modal.sessionId).toBe(SESSION)
})

test('switch-create-session-field swaps buffers on the auto-commit modal', () => {
  const state = seededState('feat: x', 'body text')
  const opened = reduceModalState(state, {
    sessionId: SESSION,
    type: 'open-auto-commit-modal',
  } as AppAction) as AppState
  const switched = reduceModalState(opened, {
    type: 'switch-create-session-field',
  } as AppAction) as AppState
  if (switched.modal.type !== 'auto-commit') throw new Error('expected auto-commit modal')
  expect(switched.modal.activeField).toBe('body')
  expect(switched.modal.editBuffer).toBe('body text')
  expect(switched.modal.contentBuffer).toBe('feat: x')
  expect(switched.modal.cursorPos).toBe('body text'.length)
})

test('open-auto-commit-modal is a no-op when no ready suggestion exists', () => {
  const state = createInitialState()
  const next = reduceModalState(state, {
    sessionId: SESSION,
    type: 'open-auto-commit-modal',
  } as AppAction)
  expect(next).toBe(state)
})
