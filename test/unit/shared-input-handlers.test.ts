import { describe, expect, test } from 'bun:test'

import type { KeyInput } from '../../src/input/modes/types'

import {
  closeModalResult,
  handleCtrlNavigation,
  handleModalSelectionKeys,
  handleTextInput,
  result,
} from '../../src/input/modes/handlers/shared'

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
  })

  test('delete removes the character in front of the cursor', () => {
    expect(handleTextInput(key({ name: 'delete' }))).toEqual({
      actions: [{ char: '\x7f', type: 'update-command-edit' }],
      effects: [],
    })
  })

  test('arrows move the cursor rather than falling through', () => {
    expect(handleTextInput(key({ name: 'left' }))).toEqual({
      actions: [{ delta: -1, type: 'move-modal-cursor' }],
      effects: [],
    })
    expect(handleTextInput(key({ name: 'right' }))).toEqual({
      actions: [{ delta: 1, type: 'move-modal-cursor' }],
      effects: [],
    })
    expect(handleTextInput(key({ name: 'up' }))).toEqual({
      actions: [{ to: 'line-up', type: 'move-modal-cursor' }],
      effects: [],
    })
    expect(handleTextInput(key({ name: 'down' }))).toEqual({
      actions: [{ to: 'line-down', type: 'move-modal-cursor' }],
      effects: [],
    })
  })

  test('home and end are line-wise, ctrl/alt + arrow is word-wise', () => {
    expect(handleTextInput(key({ name: 'home' }))).toEqual({
      actions: [{ to: 'home', type: 'move-modal-cursor' }],
      effects: [],
    })
    expect(handleTextInput(key({ name: 'end' }))).toEqual({
      actions: [{ to: 'end', type: 'move-modal-cursor' }],
      effects: [],
    })
    expect(handleTextInput(key({ ctrl: true, name: 'left' }))).toEqual({
      actions: [{ to: 'word-left', type: 'move-modal-cursor' }],
      effects: [],
    })
    expect(handleTextInput(key({ meta: true, name: 'right' }))).toEqual({
      actions: [{ to: 'word-right', type: 'move-modal-cursor' }],
      effects: [],
    })
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

describe('result helpers', () => {
  test('result omits transition when not provided', () => {
    expect(result([{ type: 'close-modal' }])).toEqual({
      actions: [{ type: 'close-modal' }],
      effects: [],
    })
  })

  test('closeModalResult closes modal and transitions to navigation by default', () => {
    expect(closeModalResult()).toEqual({
      actions: [{ type: 'close-modal' }],
      effects: [],
      transition: 'navigation',
    })
  })
})

describe('handleModalSelectionKeys', () => {
  test('j moves selection down', () => {
    expect(handleModalSelectionKeys(key({ name: 'j' }))).toEqual({
      actions: [{ delta: 1, type: 'move-modal-selection' }],
      effects: [],
    })
  })

  test('up moves selection up with derived effects', () => {
    expect(
      handleModalSelectionKeys(key({ name: 'up' }), (delta) => [
        {
          action: 'preview',
          delta,
          type: 'apply-theme',
        },
      ])
    ).toEqual({
      actions: [{ delta: -1, type: 'move-modal-selection' }],
      effects: [{ action: 'preview', delta: -1, type: 'apply-theme' }],
    })
  })

  test('other keys return null', () => {
    expect(handleModalSelectionKeys(key({ name: 'return' }))).toBeNull()
  })
})
