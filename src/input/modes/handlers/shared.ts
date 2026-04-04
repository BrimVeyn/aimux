import type { KeyInput, KeyResult } from '../types'

export function handleTextInput(key: KeyInput): KeyResult | null {
  if (key.name === 'backspace') {
    return { actions: [{ char: '\b', type: 'update-command-edit' }], effects: [] }
  }

  if (key.name === 'space') {
    return { actions: [{ char: ' ', type: 'update-command-edit' }], effects: [] }
  }

  if (key.name.length === 1) {
    const char = key.shift ? key.name.toUpperCase() : key.name
    return { actions: [{ char, type: 'update-command-edit' }], effects: [] }
  }

  return null
}

export function handleCtrlNavigation(key: KeyInput): KeyResult | null {
  if (key.ctrl && key.name === 'n') {
    return { actions: [{ delta: 1, type: 'move-modal-selection' }], effects: [] }
  }

  if (key.ctrl && key.name === 'p') {
    return { actions: [{ delta: -1, type: 'move-modal-selection' }], effects: [] }
  }

  return null
}
