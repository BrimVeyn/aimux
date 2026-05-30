import type { CliRenderer } from '@opentui/core'

import { actions } from '@brimveyn/aimux-config'

import type { KeymapModeHandler } from '../input/keymap/keymap-mode-handler'
import type { ActionFn, TrieBinding } from '../input/keymap/trie'
import type { KeyInput, KeyResult, ModeContext, ModeId } from '../input/modes/types'
import type { SessionBackend } from '../session-backend/types'
import type { AppState } from '../state/types'
import type { ThemeId } from '../ui/themes'

import { executeSideEffect } from '../app-runtime/side-effects'
import { deriveModeId } from '../input/modes/bridge'
import { getHandler, transitionTo } from '../input/modes/registry'
import { appStore } from '../state/app-store'
import { makeSideEffectContext, type TabTimeouts } from './host-side-effect-ctx'
import { encodeKeyInput } from './key-encode'

interface PipelineOptions {
  backend: SessionBackend
  /**
   * Optional pre-write hook. Called after the key was determined to be
   * unbound in terminal-input mode AND a non-null byte sequence was
   * produced. Return true to claim the bytes (no raw PTY write happens);
   * return false to let the pipeline write them as usual.
   *
   * Used by the GUI host to plug snippet-trigger detection in without
   * the driver knowing about modes or bindings.
   */
  beforeTerminalWrite?: (tabId: string, bytes: string) => boolean
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
  // When `snapshot` is passed, the ctx's state AND `ctx.getState()` resolve to
  // that pre-action snapshot. Mirrors the TUI's render-closure semantics where
  // effects observe the state as it was when the KeyResult was produced — not
  // the post-dispatch state. See processKeyResult below.
  const makeCtx = (snapshot?: AppState) =>
    makeSideEffectContext({
      backend: opts.backend,
      dispatch,
      getState: snapshot ? () => snapshot : getState,
      getThemeId: opts.getThemeId,
      renderer: opts.renderer,
      setThemeId: opts.setThemeId,
      timeouts: opts.timeouts,
    })

  function processKeyResult(result: KeyResult, modeId: ModeId): void {
    // Snapshot BEFORE dispatching actions: several effects (save-snippet-editor,
    // confirm-update-selection, paste-selected-snippet…) read state.modal.*,
    // and the actions they ship alongside frequently include `close-modal`,
    // which would otherwise wipe modal state before the effect can read it.
    const snapshot = getState()
    for (const action of result.actions) {
      dispatch(action)
    }
    if (result.transition) {
      const transResult = transitionTo(modeId, result.transition, { state: getState() })
      for (const action of transResult.actions) {
        dispatch(action)
      }
      for (const effect of transResult.effects) {
        executeSideEffect(effect, makeCtx(snapshot))
      }
    }
    for (const effect of result.effects) {
      executeSideEffect(effect, makeCtx(snapshot))
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
        if (opts.beforeTerminalWrite?.(state.activeTabId, bytes) === true) {
          return
        }
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

  // Set the modal's selected row (mouse hover). For the theme picker this also
  // runs a live preview — the preview effect reads state.modal.selectedIndex, so
  // the dispatch must land first (it does, synchronously).
  function selectModalIndex(index: number): void {
    dispatch({ index, type: 'set-modal-selection-index' })
    if (getState().modal.type === 'theme-picker') {
      runEffect({ action: 'preview', type: 'apply-theme' })
    }
  }

  // What Enter (<CR>) does per modal, mirrored from the `.mode('modal.*')` blocks
  // in packages/aimux-config/src/defaults.ts. Keyed by modal.type (not mode id).
  // The config package's Action types are structurally identical to the local
  // ones; cast bridges the duplicated declarations.
  const modalConfirmActions: Partial<Record<string, ActionFn | KeyResult>> = {
    'create-session': actions.confirmCreateSession as ActionFn,
    'new-tab': actions.launchSelectedAssistant as ActionFn,
    'session-picker': actions.confirmSelectedSession as KeyResult,
    'snippet-picker': actions.snippetFilterPaste as KeyResult,
    'split-picker': actions.confirmSplit as KeyResult,
    'theme-picker': actions.confirmTheme as KeyResult,
    'update-available': actions.confirmUpdateSelection as KeyResult,
    'worktree-move': actions.confirmWorktreeMove as ActionFn,
  }

  // Confirm the active modal's selection (Enter-equivalent) via the real action.
  function confirmActiveModal(): void {
    const modalType = getState().modal.type
    if (modalType === null) {
      return
    }
    const entry = modalConfirmActions[modalType]
    if (entry === undefined) {
      return
    }
    if (typeof entry === 'function') {
      const result = entry({ state: getState() })
      if (result !== null) {
        processKeyResult(result, deriveModeId(getState()))
      }
      return
    }
    processKeyResult(entry, deriveModeId(getState()))
  }

  return {
    confirmActiveModal,
    handleKey,
    processKeyResult,
    runEffect,
    selectModalIndex,
    wireHandlerCallbacks,
  }
}
