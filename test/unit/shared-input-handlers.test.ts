import { describe, expect, test } from 'bun:test'

import type { KeyInput } from '../../src/input/modes/types'

import { handleCtrlNavigation, handleTextInput } from '../../src/input/modes/handlers/shared'

function key(overrides: Partial<KeyInput> & { name: string }): KeyInput {
  return { ctrl: false, meta: false, sequence: overrides.name, shift: false, ...overrides }
}

describe('handleTextInput', () => {
  test('backspace emits delete char', () => {
    const result = handleTextInput(key({ name: 'backspace' }))
    expect(result).toEqual({
      actions: [{ char: '\b', type: 'update-command-edit' }],
      effects: [],
    })
  })

  test('space emits space char', () => {
    const result = handleTextInput(key({ name: 'space' }))
    expect(result).toEqual({
      actions: [{ char: ' ', type: 'update-command-edit' }],
      effects: [],
    })
  })

  test('single letter emits lowercase char', () => {
    const result = handleTextInput(key({ name: 'a' }))
    expect(result).toEqual({
      actions: [{ char: 'a', type: 'update-command-edit' }],
      effects: [],
    })
  })

  test('shift + single letter emits uppercase char', () => {
    const result = handleTextInput(key({ name: 'a', shift: true }))
    expect(result).toEqual({
      actions: [{ char: 'A', type: 'update-command-edit' }],
      effects: [],
    })
  })

  test('multi-char key names return null', () => {
    expect(handleTextInput(key({ name: 'escape' }))).toBeNull()
    expect(handleTextInput(key({ name: 'return' }))).toBeNull()
    expect(handleTextInput(key({ name: 'tab' }))).toBeNull()
    expect(handleTextInput(key({ name: 'up' }))).toBeNull()
  })
})

describe('handleCtrlNavigation', () => {
  test('ctrl+n moves selection down', () => {
    const result = handleCtrlNavigation(key({ ctrl: true, name: 'n' }))
    expect(result).toEqual({
      actions: [{ delta: 1, type: 'move-modal-selection' }],
      effects: [],
    })
  })

  test('ctrl+p moves selection up', () => {
    const result = handleCtrlNavigation(key({ ctrl: true, name: 'p' }))
    expect(result).toEqual({
      actions: [{ delta: -1, type: 'move-modal-selection' }],
      effects: [],
    })
  })

  test('non-ctrl keys return null', () => {
    expect(handleCtrlNavigation(key({ name: 'n' }))).toBeNull()
    expect(handleCtrlNavigation(key({ name: 'p' }))).toBeNull()
    expect(handleCtrlNavigation(key({ ctrl: true, name: 'j' }))).toBeNull()
  })
})
