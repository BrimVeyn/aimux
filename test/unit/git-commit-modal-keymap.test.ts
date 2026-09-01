import { getDefaultKeymapConfig, setAutoCommitEnabled } from '@brimveyn/aimux-config'
import { expect, test } from 'bun:test'

import type { KeyInput, ModeContext } from '../../src/input/modes/types'
import type { AppState } from '../../src/state/types'

import { deriveModeId } from '../../src/input/modes/bridge'
import { registerAllModes } from '../../src/input/modes/handlers'
import { getHandler } from '../../src/input/modes/registry'
import { appReducer, createInitialState } from '../../src/state/store'

registerAllModes(getDefaultKeymapConfig())
// These tests assert the auto-commit keybinding flow, so opt in explicitly.
setAutoCommitEnabled(true)

function key(
  name: string,
  opts: { ctrl?: boolean; shift?: boolean; sequence?: string } = {}
): KeyInput {
  return {
    ctrl: opts.ctrl ?? false,
    meta: false,
    name,
    sequence: opts.sequence ?? name,
    shift: opts.shift ?? false,
  }
}

function stateWithGitCommitModalOpen(): AppState {
  const base = createInitialState()
  const withProject = { ...base, currentProjectId: 'sess-1' }
  return appReducer(withProject, { projectId: 'sess-1', type: 'open-git-commit-modal' })
}

test('modal.git-commit is derived when the modal opens', () => {
  const state = stateWithGitCommitModalOpen()
  expect(state.modal.type).toBe('git-commit')
  if (state.modal.type !== 'git-commit') throw new Error('bad modal')
  expect(state.modal.stage).toBe('edit')
  expect(state.focusMode).toBe('command-edit')
  expect(deriveModeId(state)).toBe('modal.git-commit')
})

test('Ctrl+A on empty title triggers generating + side-effect', () => {
  const state = stateWithGitCommitModalOpen()
  const handler = getHandler('modal.git-commit')
  expect(handler).toBeTruthy()

  const ctx: ModeContext = { state }
  const result = handler?.handleKey(key('a', { ctrl: true }), ctx)
  expect(result).toBeTruthy()
  expect(result?.actions).toEqual([{ projectId: 'sess-1', type: 'git-commit-enter-generating' }])
  expect(result?.effects).toEqual([{ projectId: 'sess-1', type: 'generate-auto-commit-now' }])
  expect(result?.transition).toBe('modal.git-commit.generating')
})

test('Ctrl+A on non-empty title goes directly to confirm', () => {
  const state = stateWithGitCommitModalOpen()
  // simulate typing a title
  const stateWithTitle = appReducer(state, { char: 'f', type: 'update-command-edit' })
  const handler = getHandler('modal.git-commit')

  const ctx: ModeContext = { state: stateWithTitle }
  const result = handler?.handleKey(key('a', { ctrl: true }), ctx)
  expect(result?.actions).toEqual([{ type: 'git-commit-enter-confirm' }])
  expect(result?.transition).toBe('modal.git-commit.confirm')
})

test('generating stage derives modal.git-commit.generating mode id', () => {
  const state = stateWithGitCommitModalOpen()
  const next = appReducer(state, { projectId: 'sess-1', type: 'git-commit-enter-generating' })
  if (next.modal.type !== 'git-commit') throw new Error('bad modal')
  expect(next.modal.stage).toBe('generating')
  expect(next.focusMode).toBe('modal')
  expect(deriveModeId(next)).toBe('modal.git-commit.generating')
})
