// Regression for audit item C3: AI usage modal Esc must close the modal.
// Mirrors the gui-host-pipeline-git-mode pattern: dispatch key through the
// real host pipeline and observe state.

import type { CliRenderer } from '@opentui/core'

import { getDefaultKeymapConfig } from '@brimveyn/aimux-config'
import { describe, expect, test } from 'bun:test'

import type { SessionBackend } from '../../src/session-backend/types'

import { createPipeline } from '../../src/gui/host-pipeline'
import { createStubRenderer, createTabTimeouts } from '../../src/gui/host-side-effect-ctx'
import { registerAllModes } from '../../src/input/modes/handlers'
import { appStore } from '../../src/state/app-store'
import { createInitialState } from '../../src/state/store'

registerAllModes(getDefaultKeymapConfig())

function bootHost() {
  appStore.setState(createInitialState())

  const backend = {
    write: () => {},
  } as unknown as SessionBackend
  const renderer = createStubRenderer() as CliRenderer
  const timeouts = createTabTimeouts()

  const pipeline = createPipeline({
    backend,
    getThemeId: () => 'aimux',
    renderer,
    setThemeId: () => {},
    timeouts,
  })

  return { pipeline }
}

describe('GUI host pipeline · ai-usage modal', () => {
  test('Escape closes the ai-usage modal (returns to navigation)', () => {
    const { pipeline } = bootHost()
    appStore.getState().dispatch({ type: 'open-ai-usage-modal' })
    expect(appStore.getState().modal.type).toBe('ai-usage')
    expect(appStore.getState().focusMode).toBe('modal')

    pipeline.handleKey({
      ctrl: false,
      meta: false,
      name: 'escape',
      sequence: '',
      shift: false,
    })

    const state = appStore.getState()
    expect(state.modal.type).toBeNull()
    expect(state.focusMode).toBe('navigation')
  })

  test('open-ai-usage-modal dispatched directly (web-native open path) still opens', () => {
    const { pipeline: _pipeline } = bootHost()
    appStore.getState().dispatch({ type: 'open-ai-usage-modal' })
    expect(appStore.getState().modal.type).toBe('ai-usage')
  })
})
