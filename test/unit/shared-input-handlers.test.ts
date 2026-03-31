import { describe, expect, test } from 'bun:test'

import type { KeyInput } from '../../src/input/modes/types'

import { handleCtrlNavigation, handleTextInput } from '../../src/input/modes/handlers/shared'

function key(overrides: Partial<KeyInput> & { name: string }): KeyInput {
  return { ctrl: false, meta: false, shift: false, sequence: overrides.name, ...overrides }
}

describe('handleTextInput', () => {
  test('backspace emits delete char', () => {
    const result = handleTextInput(key({ name: 'backspace' }))
    expect(result).toEqual({
      actions: [{ type: 'update-command-edit', char: '\b' }],
      effects: [],
    })
  })

  test('space emits space char', () => {
    const result = handleTextInput(key({ name: 'space' }))
    expect(result).toEqual({
      actions: [{ type: 'update-command-edit', char: ' ' }],
      effects: [],
    })
  })

  test('single letter emits lowercase char', () => {
    const result = handleTextInput(key({ name: 'a' }))
    expect(result).toEqual({
      actions: [{ type: 'update-command-edit', char: 'a' }],
      effects: [],
    })
  })

  test('shift + single letter emits uppercase char', () => {
    const result = handleTextInput(key({ name: 'a', shift: true }))
    expect(result).toEqual({
      actions: [{ type: 'update-command-edit', char: 'A' }],
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
    const result = handleCtrlNavigation(key({ name: 'n', ctrl: true }))
    expect(result).toEqual({
      actions: [{ type: 'move-modal-selection', delta: 1 }],
      effects: [],
    })
  })

  test('ctrl+p moves selection up', () => {
    const result = handleCtrlNavigation(key({ name: 'p', ctrl: true }))
    expect(result).toEqual({
      actions: [{ type: 'move-modal-selection', delta: -1 }],
      effects: [],
    })
  })

  test('non-ctrl keys return null', () => {
    expect(handleCtrlNavigation(key({ name: 'n' }))).toBeNull()
    expect(handleCtrlNavigation(key({ name: 'p' }))).toBeNull()
    expect(handleCtrlNavigation(key({ name: 'j', ctrl: true }))).toBeNull()
  })
})
