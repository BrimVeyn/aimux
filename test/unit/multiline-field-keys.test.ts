import { getDefaultKeymapConfig } from '@brimveyn/aimux-config'
import { describe, expect, test } from 'bun:test'

import type { KeyInput } from '../../src/input/modes/types'
import type { AppState } from '../../src/state/types'

import { deriveModeId } from '../../src/input/modes/bridge'
import { registerAllModes } from '../../src/input/modes/handlers'
import { getHandler } from '../../src/input/modes/registry'
import { appReducer, createInitialState } from '../../src/state/store'

registerAllModes(getDefaultKeymapConfig())

/**
 * Shift+Enter only reaches the app when the host terminal reports the modifier
 * (kitty keyboard protocol, which opentui turns on). This is the shape it
 * arrives in — the rest of the chain is what these tests pin down.
 */
const SHIFT_ENTER: KeyInput = {
  ctrl: false,
  meta: false,
  name: 'return',
  sequence: '\r',
  shift: true,
}

function press(state: AppState, key: KeyInput): AppState {
  const handler = getHandler(deriveModeId(state))
  if (!handler) throw new Error(`no handler for ${deriveModeId(state)}`)
  const result = handler.handleKey(key, { state })
  if (!result) throw new Error('key was not handled')
  let next = state
  for (const action of result.actions) next = appReducer(next, action)
  return next
}

describe('shift+enter inserts a newline, it does not submit', () => {
  test('create-workspace prompt (Ctrl+P)', () => {
    let state = appReducer(
      { ...createInitialState(), currentProjectId: 'p1' },
      { type: 'open-create-workspace-modal' }
    )
    state = press(state, { ...SHIFT_ENTER, name: 'a', sequence: 'a', shift: false })
    state = press(state, SHIFT_ENTER)
    state = press(state, { ...SHIFT_ENTER, name: 'b', sequence: 'b', shift: false })
    if (state.modal.type !== 'create-workspace') throw new Error('modal closed')
    expect(state.modal.prompt).toBe('a\nb')
  })

  test('git commit body', () => {
    let state = appReducer(
      { ...createInitialState(), currentProjectId: 'p1' },
      { projectId: 'p1', type: 'open-git-commit-modal' }
    )
    state = appReducer(state, { type: 'switch-create-project-field' })
    state = press(state, { ...SHIFT_ENTER, name: 'a', sequence: 'a', shift: false })
    state = press(state, SHIFT_ENTER)
    if (state.modal.type !== 'git-commit') throw new Error('modal closed')
    expect(state.modal.activeField).toBe('body')
    expect(state.modal.editBuffer).toBe('a\n')
  })
})

describe('the cursor can be moved back into what was typed', () => {
  test('left, then a character, inserts in the middle', () => {
    let state = appReducer(
      { ...createInitialState(), currentProjectId: 'p1' },
      { type: 'open-create-workspace-modal' }
    )
    for (const ch of 'ac') {
      state = press(state, { ctrl: false, meta: false, name: ch, sequence: ch, shift: false })
    }
    state = press(state, {
      ctrl: false,
      meta: false,
      name: 'left',
      sequence: '\x1b[D',
      shift: false,
    })
    state = press(state, { ctrl: false, meta: false, name: 'b', sequence: 'b', shift: false })
    if (state.modal.type !== 'create-workspace') throw new Error('modal closed')
    expect(state.modal.prompt).toBe('abc')
  })

  test('up walks back to the line above, not into the base list', () => {
    let state = appReducer(
      { ...createInitialState(), currentProjectId: 'p1' },
      { type: 'open-create-workspace-modal' }
    )
    state = press(state, { ctrl: false, meta: false, name: 'a', sequence: 'a', shift: false })
    state = press(state, SHIFT_ENTER)
    state = press(state, { ctrl: false, meta: false, name: 'b', sequence: 'b', shift: false })
    state = press(state, { ctrl: false, meta: false, name: 'up', sequence: '\x1b[A', shift: false })
    if (state.modal.type !== 'create-workspace') throw new Error('modal closed')
    expect(state.modal.prompt).toBe('a\nb')
    // column 1 of line 0 — beside the "a", not at the end of the buffer.
    expect(state.modal.cursorPos).toBe(1)
  })
})
