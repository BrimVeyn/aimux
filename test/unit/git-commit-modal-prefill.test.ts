import { expect, test } from 'bun:test'

import type { AppAction } from '../../src/state/actions'
import type { AppState, AutoCommitState } from '../../src/state/types'

import { reduceModalState } from '../../src/state/reducers/modal-state'
import { createInitialState } from '../../src/state/store'

const PROJECT = 's1'
const HASH = 'h1'

function stateWithReadySuggestion(title: string, body: string): AppState {
  const base = createInitialState()
  const autoCommit: AutoCommitState = {
    byProject: {
      [PROJECT]: {
        body,
        generatedAt: 1,
        kind: 'ready',
        tabId: 't1',
        title,
        workingTreeHash: HASH,
      },
    },
  }
  return { ...base, autoCommit, currentProjectId: PROJECT }
}

test('open-git-commit-modal always opens empty, even with a ready suggestion', () => {
  const state = stateWithReadySuggestion('feat: add thing', 'body text')
  const next = reduceModalState(state, {
    projectId: PROJECT,
    type: 'open-git-commit-modal',
  } as AppAction)
  expect(next).not.toBeNull()
  const n = next as AppState
  if (n.modal.type !== 'git-commit') throw new Error('expected git-commit modal')
  expect(n.focusMode).toBe('command-edit')
  expect(n.modal.activeField).toBe('title')
  expect(n.modal.editBuffer).toBe('')
  expect(n.modal.contentBuffer).toBe('')
  expect(n.modal.cursorPos).toBe(0)
  expect(n.modal.stage).toBe('edit')
})

test('git-commit-use-background-suggestion fills title/body and enters confirm', () => {
  const state = stateWithReadySuggestion('feat: x', 'body')
  const opened = reduceModalState(state, {
    projectId: PROJECT,
    type: 'open-git-commit-modal',
  } as AppAction) as AppState
  const next = reduceModalState(opened, {
    projectId: PROJECT,
    type: 'git-commit-use-background-suggestion',
  } as AppAction)
  expect(next).not.toBeNull()
  const n = next as AppState
  if (n.modal.type !== 'git-commit') throw new Error('expected git-commit modal')
  expect(n.modal.stage).toBe('confirm')
  expect(n.modal.editBuffer).toBe('feat: x')
  expect(n.modal.contentBuffer).toBe('body')
  expect(n.modal.activeField).toBe('title')
  expect(n.modal.cursorPos).toBe('feat: x'.length)
})

test('git-commit-use-background-suggestion is a no-op when suggestion is not ready', () => {
  const base = createInitialState()
  const opened = reduceModalState(base, {
    projectId: PROJECT,
    type: 'open-git-commit-modal',
  } as AppAction) as AppState
  const next = reduceModalState(opened, {
    projectId: PROJECT,
    type: 'git-commit-use-background-suggestion',
  } as AppAction)
  expect(next).toBeNull()
})

test('open-git-commit-modal falls back to empty when no ready suggestion exists', () => {
  const base = createInitialState()
  const next = reduceModalState(base, {
    projectId: PROJECT,
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

test('open-git-commit-modal without projectId opens empty', () => {
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
    projectId: PROJECT,
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
    projectId: PROJECT,
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
    projectId: PROJECT,
    type: 'open-git-commit-modal',
  } as AppAction) as AppState
  const next = reduceModalState(opened, {
    projectId: PROJECT,
    type: 'git-commit-enter-generating',
  } as AppAction) as AppState
  if (next.modal.type !== 'git-commit') throw new Error('expected git-commit modal')
  expect(next.modal.stage).toBe('generating')
  expect(next.modal.projectTargetId).toBe(PROJECT)
  expect(next.focusMode).toBe('modal')
})

test('auto-commit-generation-ready while generating fills fields and enters confirm', () => {
  const base = createInitialState()
  const opened = reduceModalState(base, {
    projectId: PROJECT,
    type: 'open-git-commit-modal',
  } as AppAction) as AppState
  const generating = reduceModalState(opened, {
    projectId: PROJECT,
    type: 'git-commit-enter-generating',
  } as AppAction) as AppState
  const withInFlight = {
    ...generating,
    autoCommit: {
      byProject: {
        [PROJECT]: {
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
    projectId: PROJECT,
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
    projectId: PROJECT,
    type: 'open-git-commit-modal',
  } as AppAction) as AppState
  const generating = reduceModalState(opened, {
    projectId: PROJECT,
    type: 'git-commit-enter-generating',
  } as AppAction) as AppState
  const cleared = reduceModalState(generating, {
    projectId: PROJECT,
    type: 'auto-commit-clear',
  } as AppAction) as AppState
  if (cleared.modal.type !== 'git-commit') throw new Error('expected git-commit modal')
  expect(cleared.modal.stage).toBe('edit')
})

test('auto-commit-generation-ready for a different project does not touch the modal', () => {
  const base = createInitialState()
  const opened = reduceModalState(base, {
    projectId: PROJECT,
    type: 'open-git-commit-modal',
  } as AppAction) as AppState
  const generating = reduceModalState(opened, {
    projectId: PROJECT,
    type: 'git-commit-enter-generating',
  } as AppAction) as AppState
  const result = reduceModalState(generating, {
    body: 'x',
    generatedAt: 1,
    projectId: 'other-project',
    title: 'x',
    type: 'auto-commit-generation-ready',
    workingTreeHash: 'h',
  } as AppAction)
  expect(result).toBeNull()
})

test('switch-create-project-field swaps buffers on the git-commit modal', () => {
  const base = createInitialState()
  const opened = reduceModalState(base, {
    projectId: PROJECT,
    type: 'open-git-commit-modal',
  } as AppAction) as AppState
  if (opened.modal.type !== 'git-commit') throw new Error('expected git-commit modal')
  const filled: AppState = {
    ...opened,
    modal: { ...opened.modal, contentBuffer: 'body text', editBuffer: 'feat: x' },
  }
  const switched = reduceModalState(filled, {
    type: 'switch-create-project-field',
  } as AppAction) as AppState
  if (switched.modal.type !== 'git-commit') throw new Error('expected git-commit modal')
  expect(switched.modal.activeField).toBe('body')
  expect(switched.modal.editBuffer).toBe('body text')
  expect(switched.modal.contentBuffer).toBe('feat: x')
})
