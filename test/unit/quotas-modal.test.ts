import { describe, expect, test } from 'bun:test'

import { deriveModeId } from '../../src/input/modes/bridge'
import { isValidTransition } from '../../src/input/modes/transitions'
import { appReducer, createInitialState } from '../../src/state/store'

/**
 * The status bar's usage indicator opens the quota windows, not the whole
 * screen.
 *
 * Four pieces have to agree for a modal to work at all — the reducer, the mode
 * the bridge derives from it, the transition into that mode, and the way out —
 * and three of them live in different files. This is the wiring, not the view.
 */
describe('quotas modal', () => {
  test('opening it puts focus on a modal the bridge can name', () => {
    const opened = appReducer(createInitialState(), { type: 'open-quotas-modal' })

    expect(opened.focusMode).toBe('modal')
    expect(opened.modal.type).toBe('quotas')
    expect(deriveModeId(opened)).toBe('modal.quotas')
  })

  test('it opens from the panes and from a focused terminal', () => {
    // The indicator sits in the status bar, which is on screen in both.
    expect(isValidTransition('navigation', 'modal.quotas')).toBe(true)
    expect(isValidTransition('terminal-input', 'modal.quotas')).toBe(true)
  })

  test('closing it goes back to the panes', () => {
    const opened = appReducer(createInitialState(), { type: 'open-quotas-modal' })
    const closed = appReducer(opened, { type: 'close-modal' })

    expect(closed.modal.type).toBeNull()
    expect(isValidTransition('modal.quotas', 'navigation')).toBe(true)
  })

  test('it does not open the stats screen — that is the Stats button', () => {
    const opened = appReducer(createInitialState(), { type: 'open-quotas-modal' })
    expect(opened.focusMode).not.toBe('stats')
  })
})
