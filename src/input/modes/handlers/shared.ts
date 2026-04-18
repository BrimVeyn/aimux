import type { AppAction } from '../../../state/types'
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

export function handleTextInput(key: KeyInput): KeyResult | null {
  if (key.name === 'backspace') {
    return result([{ char: '\b', type: 'update-command-edit' }])
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
