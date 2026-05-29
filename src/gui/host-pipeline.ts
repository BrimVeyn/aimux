import type { CliRenderer } from '@opentui/core'

import type { KeymapModeHandler } from '../input/keymap/keymap-mode-handler'
import type { TrieBinding } from '../input/keymap/trie'
import type { KeyInput, KeyResult, ModeContext, ModeId } from '../input/modes/types'
import type { SessionBackend } from '../session-backend/types'
import type { ThemeId } from '../ui/themes'

import { executeSideEffect } from '../app-runtime/side-effects'
import { deriveModeId } from '../input/modes/bridge'
import { getHandler, transitionTo } from '../input/modes/registry'
import { appStore } from '../state/app-store'
import { makeSideEffectContext, type TabTimeouts } from './host-side-effect-ctx'
import { encodeKeyInput } from './key-encode'

interface PipelineOptions {
  backend: SessionBackend
  renderer: CliRenderer
  timeouts: TabTimeouts
  getThemeId: () => ThemeId
  setThemeId: (id: ThemeId) => void
}

// Host port of app.tsx's processKeyResult + useKeyboard pipeline: browser key →
// keymap/mode handler → action/transition/effect, with terminal-input passthrough
// to the PTY for unbound keys.
export function createPipeline(opts: PipelineOptions) {
  const dispatch = (
    action: Parameters<ReturnType<typeof appStore.getState>['dispatch']>[0]
  ): void => appStore.getState().dispatch(action)
  const getState = () => appStore.getState()
  const makeCtx = () =>
    makeSideEffectContext({
      backend: opts.backend,
      dispatch,
      getState,
      getThemeId: opts.getThemeId,
      renderer: opts.renderer,
      setThemeId: opts.setThemeId,
      timeouts: opts.timeouts,
    })

  function processKeyResult(result: KeyResult, modeId: ModeId): void {
    for (const action of result.actions) {
      dispatch(action)
    }
    if (result.transition) {
      const transResult = transitionTo(modeId, result.transition, { state: getState() })
      for (const action of transResult.actions) {
        dispatch(action)
      }
      for (const effect of transResult.effects) {
        executeSideEffect(effect, makeCtx())
      }
    }
    for (const effect of result.effects) {
      executeSideEffect(effect, makeCtx())
    }
  }

  function handleKey(key: KeyInput): void {
    const state = getState()
    // Global quit: Ctrl+C in any mode except terminal-input.
    if (key.ctrl && key.name === 'c' && state.focusMode !== 'terminal-input') {
      executeSideEffect({ state, type: 'quit' }, makeCtx())
      return
    }

    const modeId = deriveModeId(state)
    const handler = getHandler(modeId)
    if (!handler) {
      return
    }

    const ctx: ModeContext = { state }
    const result = handler.handleKey(key, ctx)
    if (result) {
      processKeyResult(result, modeId)
      return
    }

    // Unbound key in terminal-input mode → forward raw bytes to the active PTY.
    if (modeId === 'terminal-input' && state.activeTabId !== null) {
      const bytes = encodeKeyInput(key)
      if (bytes !== null) {
        opts.backend.write(state.activeTabId, bytes)
      }
    }
  }

  function wireHandlerCallbacks(handlers: KeymapModeHandler[]): void {
    for (const handler of handlers) {
      handler.setTimeoutCallback((binding: TrieBinding) => {
        const state = getState()
        const modeId = deriveModeId(state)
        if (modeId !== handler.id) {
          return
        }
        const ctx: ModeContext = { state }
        const result = typeof binding.result === 'function' ? binding.result(ctx) : binding.result
        if (result) {
          processKeyResult(result, modeId)
        }
      })
      handler.setPendingChangeCallback((chords) => {
        dispatch({ chords, type: 'set-pending-chords' })
      })
    }
  }

  const runEffect = (effect: Parameters<typeof executeSideEffect>[0]): void =>
    executeSideEffect(effect, makeCtx())

  return { handleKey, processKeyResult, runEffect, wireHandlerCallbacks }
}
