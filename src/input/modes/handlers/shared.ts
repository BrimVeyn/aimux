import type { AppAction } from '../../../state/actions'
import type { KeyInput, KeyResult, ModeId, SideEffect } from '../types'

type SelectionDelta = -1 | 1

export function result(
  actions: AppAction[] = [],
  effects: SideEffect[] = [],
  transition?: ModeId
): KeyResult {
  return transition ? { actions, effects, transition } : { actions, effects }
}

export function closeModalResult(
  effects: SideEffect[] = [],
  transition: ModeId = 'navigation'
): KeyResult {
  return result([{ type: 'close-modal' }], effects, transition)
}

export function moveModalSelectionResult(
  delta: SelectionDelta,
  effects: SideEffect[] = []
): KeyResult {
  return result([{ delta, type: 'move-modal-selection' }], effects)
}

export function handleModalSelectionKeys(
  key: KeyInput,
  getEffects?: (delta: SelectionDelta) => SideEffect[]
): KeyResult | null {
  if (key.name === 'j' || key.name === 'down') {
    return moveModalSelectionResult(1, getEffects?.(1) ?? [])
  }

  if (key.name === 'k' || key.name === 'up') {
    return moveModalSelectionResult(-1, getEffects?.(-1) ?? [])
  }

  return null
}

/**
 * Cursor motion for a key no binding claimed.
 *
 * Every modal that accepts typing is a `passthrough()` mode, and this is the one
 * function they all fall through to — so a motion added here reaches every text
 * field in the app at once, without a binding per modal. The modals that do bind
 * an arrow (the update prompt's row of buttons, the git and settings screens)
 * resolve it before it ever gets here.
 */
function handleCursorMotion(key: KeyInput): KeyResult | null {
  const word = key.ctrl || key.meta
  switch (key.name) {
    case 'left':
      return result([
        word
          ? { to: 'word-left', type: 'move-modal-cursor' }
          : { delta: -1, type: 'move-modal-cursor' },
      ])
    case 'right':
      return result([
        word
          ? { to: 'word-right', type: 'move-modal-cursor' }
          : { delta: 1, type: 'move-modal-cursor' },
      ])
    case 'home':
      return result([{ to: 'home', type: 'move-modal-cursor' }])
    case 'end':
      return result([{ to: 'end', type: 'move-modal-cursor' }])
    // Only reached in a modal that leaves Up/Down unbound — the ones that drive a
    // list with them hand their own action a `moveModalCursorInField` fallback.
    case 'up':
      return result([{ to: 'line-up', type: 'move-modal-cursor' }])
    case 'down':
      return result([{ to: 'line-down', type: 'move-modal-cursor' }])
    default:
      return null
  }
}

export function handleTextInput(key: KeyInput): KeyResult | null {
  const motion = handleCursorMotion(key)
  if (motion) return motion

  if (key.name === 'backspace') {
    return result([{ char: '\b', type: 'update-command-edit' }])
  }

  // DEL, the counterpart to backspace: both are commands rather than text
  // because neither can arrive as a typed character.
  if (key.name === 'delete') {
    return result([{ char: '\x7f', type: 'update-command-edit' }])
  }

  if (key.name === 'space') {
    return result([{ char: ' ', type: 'update-command-edit' }])
  }

  if (key.name.length === 1) {
    const char = key.shift ? key.name.toUpperCase() : key.name
    return result([{ char, type: 'update-command-edit' }])
  }

  return null
}

export function handleCtrlNavigation(key: KeyInput): KeyResult | null {
  if (key.ctrl && key.name === 'n') {
    return moveModalSelectionResult(1)
  }

  if (key.ctrl && key.name === 'p') {
    return moveModalSelectionResult(-1)
  }

  return null
}
