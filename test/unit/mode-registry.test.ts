import { beforeEach, describe, expect, test } from 'bun:test'

import type { KeyResult, ModeContext, ModeHandler } from '../../src/input/modes/types'
import type { AppState } from '../../src/state/types'

import { deriveModeId } from '../../src/input/modes/bridge'
import { registerMode, transitionTo } from '../../src/input/modes/registry'
import { appReducer, createInitialState } from '../../src/state/store'

function makeState(overrides: Partial<AppState>): AppState {
  return { ...createInitialState(), ...overrides }
}

function createHandler(handler: ModeHandler): ModeHandler {
  return handler
}

describe('deriveModeId', () => {
  test('maps direct focus modes without modal inspection', () => {
    expect(deriveModeId(makeState({ focusMode: 'navigation' }))).toBe('navigation')
    expect(deriveModeId(makeState({ focusMode: 'terminal-input' }))).toBe('terminal-input')
    expect(deriveModeId(makeState({ focusMode: 'git' }))).toBe('git-mode')
  })

  test('maps command-edit modal states', () => {
    expect(
      deriveModeId(
        makeState({
          focusMode: 'command-edit',
          modal: { ...createInitialState().modal, type: 'snippet-picker' },
        })
      )
    ).toBe('modal.snippet-picker.filtering')
  })

  test('an open modal wins over a clobbered focusMode', () => {
    // focusMode records whoever opened the modal, but a background side effect
    // can rewrite it while the modal is still up. The modal still owns input.
    const workspace = appReducer(createInitialState(), { type: 'open-create-workspace-modal' })
    expect(deriveModeId({ ...workspace, focusMode: 'terminal-input' })).toBe(
      'modal.create-workspace'
    )

    expect(
      deriveModeId(
        makeState({
          focusMode: 'modal',
          modal: {
            ...createInitialState().modal,
            returnToProjectPicker: true,
            type: 'project-name',
          },
        })
      )
    ).toBe('modal.project-name')
  })

  test('falls back to navigation for a focus with no mode of its own and no modal', () => {
    // `command-edit` and `modal` only ever name a mode through the modal that
    // is open. With the modal closed there is nothing to route to.
    expect(deriveModeId(makeState({ focusMode: 'command-edit' }))).toBe('navigation')
    expect(deriveModeId(makeState({ focusMode: 'modal' }))).toBe('navigation')
  })
})

describe('transitionTo', () => {
  const state = createInitialState()
  const ctx: ModeContext = { state }

  beforeEach(() => {
    registerMode(
      createHandler({
        handleKey: () => null,
        id: 'navigation',
        onExit: (): KeyResult => ({
          actions: [{ type: 'open-help-modal' }],
          effects: [],
        }),
      })
    )

    registerMode(
      createHandler({
        handleKey: () => null,
        id: 'modal.help.filtering',
        onEnter: (): KeyResult => ({
          actions: [{ type: 'close-modal' }],
          effects: [{ state, type: 'quit' }],
        }),
      })
    )
  })

  test('combines exit and enter hooks for valid transitions', () => {
    expect(transitionTo('navigation', 'modal.help.filtering', ctx)).toEqual({
      actions: [{ type: 'open-help-modal' }, { type: 'close-modal' }],
      effects: [{ state, type: 'quit' }],
      transition: 'modal.help.filtering',
    })
  })

  test('returns empty result for invalid transitions', () => {
    expect(transitionTo('modal.help.filtering', 'git-mode', ctx)).toEqual({
      actions: [],
      effects: [],
    })
  })
})
