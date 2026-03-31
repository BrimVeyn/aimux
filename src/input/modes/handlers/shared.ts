import type { KeyInput, KeyResult } from '../types'

export function handleTextInput(key: KeyInput): KeyResult | null {
  if (key.name === 'backspace') {
    return { actions: [{ type: 'update-command-edit', char: '\b' }], effects: [] }
  }

  if (key.name === 'space') {
    return { actions: [{ type: 'update-command-edit', char: ' ' }], effects: [] }
  }

  if (key.name.length === 1) {
    const char = key.shift ? key.name.toUpperCase() : key.name
    return { actions: [{ type: 'update-command-edit', char }], effects: [] }
  }

  return null
}

export function handleCtrlNavigation(key: KeyInput): KeyResult | null {
  if (key.ctrl && key.name === 'n') {
    return { actions: [{ type: 'move-modal-selection', delta: 1 }], effects: [] }
  }

  if (key.ctrl && key.name === 'p') {
    return { actions: [{ type: 'move-modal-selection', delta: -1 }], effects: [] }
  }

  return null
}
