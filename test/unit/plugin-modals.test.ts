import { afterEach, describe, expect, test } from 'bun:test'

import { clearHelpModeLabels, helpModeLabels } from '../../src/input/keymap/help-entries'
import { clearModeDerivations, deriveModeId } from '../../src/input/modes/bridge'
import { clearPluginModes, registeredPluginModes } from '../../src/input/modes/transitions'
import { appReducer, createInitialState } from '../../src/state/store'
import {
  clearPluginModals,
  getPluginModal,
  listPluginModals,
  registerPluginModal,
} from '../../src/ui/plugin-modals'

/**
 * One `plugin-modal` arm carries every plugin modal, so `root.tsx`'s switch
 * keeps its exhaustiveness check. What has to be verified is the routing: the
 * right modal renders, input reaches it, and closing behaves like every other
 * modal.
 */

const MODAL = {
  id: 'acme.thing.confirm',
  pluginId: 'acme.thing',
  render: () => null,
  title: 'Acme confirm',
}

afterEach(() => {
  clearPluginModals()
  clearPluginModes()
  clearModeDerivations()
  clearHelpModeLabels()
})

describe('plugin modals', () => {
  test('registering wires the renderer, the mode and the heading', () => {
    registerPluginModal(MODAL)
    expect(getPluginModal('acme.thing.confirm')?.title).toBe('Acme confirm')
    expect(registeredPluginModes()).toEqual(['plugin.acme.thing.confirm'])
    expect(helpModeLabels().at(-1)?.modeId).toBe('plugin.acme.thing.confirm')
  })

  test('opening qualifies the id and carries the props through untouched', () => {
    registerPluginModal(MODAL)
    let state = createInitialState()
    state = appReducer(state, {
      modalId: 'confirm',
      pluginId: 'acme.thing',
      props: { question: 'sure?' },
      type: 'open-plugin-modal',
    })

    expect(state.focusMode).toBe('modal')
    expect(state.modal.type).toBe('plugin-modal')
    if (state.modal.type !== 'plugin-modal') return
    expect(state.modal.modalId).toBe('acme.thing.confirm')
    // Opaque to the reducer on purpose: a plugin modal's state is the plugin's.
    expect(state.modal.props).toEqual({ question: 'sure?' })
  })

  test('input routes to the modal mode while it is open', () => {
    registerPluginModal(MODAL)
    let state = createInitialState()
    state = appReducer(state, {
      modalId: 'confirm',
      pluginId: 'acme.thing',
      type: 'open-plugin-modal',
    })
    expect(deriveModeId(state)).toBe('plugin.acme.thing.confirm')
  })

  test('close-modal closes it like any other modal', () => {
    registerPluginModal(MODAL)
    let state = createInitialState()
    state = appReducer(state, {
      modalId: 'confirm',
      pluginId: 'acme.thing',
      type: 'open-plugin-modal',
    })
    state = appReducer(state, { type: 'close-modal' })

    expect(state.modal.type).toBeNull()
    expect(state.focusMode).toBe('navigation')
    expect(deriveModeId(state)).toBe('navigation')
  })

  test('returnTo is honoured, so a modal opened from a screen goes back to it', () => {
    registerPluginModal(MODAL)
    let state = createInitialState()
    state = appReducer(state, {
      modalId: 'confirm',
      pluginId: 'acme.thing',
      returnTo: 'settings',
      type: 'open-plugin-modal',
    })
    state = appReducer(state, { type: 'close-modal' })
    expect(state.focusMode).toBe('settings')
  })

  test('a second modal does not claim the first one s input', () => {
    registerPluginModal(MODAL)
    registerPluginModal({ ...MODAL, id: 'acme.thing.other', title: 'Other' })
    let state = createInitialState()
    state = appReducer(state, {
      modalId: 'other',
      pluginId: 'acme.thing',
      type: 'open-plugin-modal',
    })
    expect(deriveModeId(state)).toBe('plugin.acme.thing.other')
  })

  test('the disposer unwinds every registration', () => {
    const dispose = registerPluginModal(MODAL)
    const headings = helpModeLabels().length
    dispose()

    expect(getPluginModal('acme.thing.confirm')).toBeUndefined()
    expect(registeredPluginModes()).toEqual([])
    expect(helpModeLabels()).toHaveLength(headings - 1)
    expect(listPluginModals()).toEqual([])
  })

  test('an unregistered modal still derives navigation rather than a dead mode', () => {
    // The plugin unloaded while its modal was open.
    let state = createInitialState()
    state = appReducer(state, {
      modalId: 'gone',
      pluginId: 'acme.thing',
      type: 'open-plugin-modal',
    })
    expect(deriveModeId(state)).toBe('navigation')
  })
})
