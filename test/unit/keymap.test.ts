import { describe, expect, test } from 'bun:test'

import type { KeyInput, ModeContext } from '../../src/input/modes/types'

import { registerAllModes } from '../../src/input/modes/handlers'
import { getHandler } from '../../src/input/modes/registry'
import { createInitialState } from '../../src/state/store'

registerAllModes()

function key(
  name: string,
  opts: { ctrl?: boolean; shift?: boolean; sequence?: string } = {}
): KeyInput {
  return {
    name,
    ctrl: opts.ctrl ?? false,
    meta: false,
    shift: opts.shift ?? false,
    sequence: opts.sequence ?? name,
  }
}

function ctx(overrides?: Partial<ReturnType<typeof createInitialState>>): ModeContext {
  const state = createInitialState({}, [], [], false)
  return { state: { ...state, ...overrides } }
}

describe('mode handlers', () => {
  test('navigation: maps j/k to move-active-tab', () => {
    const handler = getHandler('navigation')!
    const result = handler.handleKey(key('j'), ctx())
    expect(result).not.toBeNull()
    expect(result!.actions).toEqual([{ type: 'move-active-tab', delta: 1 }])
  })

  test('navigation: Ctrl+W dispatches close-active-tab', () => {
    const handler = getHandler('navigation')!
    const result = handler.handleKey(key('w', { ctrl: true }), ctx({ activeTabId: 'tab-1' }))
    expect(result).not.toBeNull()
    expect(result!.actions).toEqual([{ type: 'close-active-tab' }])
    expect(result!.effects).toEqual([{ type: 'close-tab', tabId: 'tab-1' }])
  })

  test('navigation: Ctrl+R triggers restart-tab effect', () => {
    const tab = {
      id: 'tab-1',
      assistant: 'claude' as const,
      title: 'Claude',
      status: 'running' as const,
      buffer: '',
      terminalModes: {
        mouseTrackingMode: 'none' as const,
        sendFocusMode: false,
        alternateScrollMode: false,
        isAlternateBuffer: false,
        bracketedPasteMode: false,
      },
      command: 'claude',
    }
    const handler = getHandler('navigation')!
    const result = handler.handleKey(
      key('r', { ctrl: true }),
      ctx({ activeTabId: 'tab-1', tabs: [tab] })
    )
    expect(result).not.toBeNull()
    expect(result!.effects[0]?.type).toBe('restart-tab')
  })

  test('navigation: Ctrl+G opens session picker', () => {
    const handler = getHandler('navigation')!
    const result = handler.handleKey(key('g', { ctrl: true }), ctx())
    expect(result).not.toBeNull()
    expect(result!.actions).toEqual([{ type: 'open-session-picker' }])
    expect(result!.transition).toBe('modal.session-picker')
  })

  test('navigation: Shift+J reorders tab', () => {
    const handler = getHandler('navigation')!
    const result = handler.handleKey(key('j', { shift: true }), ctx())
    expect(result).not.toBeNull()
    expect(result!.actions).toEqual([{ type: 'reorder-active-tab', delta: 1 }])
  })

  test('navigation: Shift+K reorders tab up', () => {
    const handler = getHandler('navigation')!
    const result = handler.handleKey(key('k', { shift: true }), ctx())
    expect(result).not.toBeNull()
    expect(result!.actions).toEqual([{ type: 'reorder-active-tab', delta: -1 }])
  })

  test('navigation: i transitions to terminal-input', () => {
    const handler = getHandler('navigation')!
    const result = handler.handleKey(key('i'), ctx({ activeTabId: 'tab-1' }))
    expect(result).not.toBeNull()
    expect(result!.transition).toBe('terminal-input')
  })

  test('modal.help: escape closes modal', () => {
    const handler = getHandler('modal.help')!
    const result = handler.handleKey(key('escape'), ctx())
    expect(result).not.toBeNull()
    expect(result!.actions).toEqual([{ type: 'close-modal' }])
    expect(result!.transition).toBe('navigation')
  })

  test('modal.help: Ctrl+B is not handled', () => {
    const handler = getHandler('modal.help')!
    const result = handler.handleKey(key('b', { ctrl: true }), ctx())
    expect(result).toBeNull()
  })

  test('terminal-input: all keys return null', () => {
    const handler = getHandler('terminal-input')!
    expect(handler.handleKey(key('z', { ctrl: true }), ctx())).toBeNull()
    expect(handler.handleKey(key('l', { ctrl: true }), ctx())).toBeNull()
    expect(handler.handleKey(key('w', { ctrl: true }), ctx())).toBeNull()
  })

  test('modal.session-picker: escape blocked without currentSessionId', () => {
    const handler = getHandler('modal.session-picker')!
    const result = handler.handleKey(key('escape'), ctx({ currentSessionId: null }))
    expect(result).toBeNull()
  })

  test('modal.session-picker: escape works with currentSessionId', () => {
    const handler = getHandler('modal.session-picker')!
    const result = handler.handleKey(key('escape'), ctx({ currentSessionId: 's-1' }))
    expect(result).not.toBeNull()
    expect(result!.transition).toBe('navigation')
  })

  test('modal.session-picker: n opens create-session', () => {
    const handler = getHandler('modal.session-picker')!
    const result = handler.handleKey(key('n'), ctx())
    expect(result).not.toBeNull()
    expect(result!.transition).toBe('modal.create-session')
  })

  test('modal.snippet-picker: n opens snippet-editor', () => {
    const handler = getHandler('modal.snippet-picker')!
    const result = handler.handleKey(key('n'), ctx())
    expect(result).not.toBeNull()
    expect(result!.transition).toBe('modal.snippet-editor')
  })

  test('modal.new-tab: e enters command edit', () => {
    const handler = getHandler('modal.new-tab')!
    const result = handler.handleKey(key('e'), ctx())
    expect(result).not.toBeNull()
    expect(result!.transition).toBe('modal.new-tab.command-edit')
  })

  test('modal.theme-picker: return confirms theme', () => {
    const handler = getHandler('modal.theme-picker')!
    const result = handler.handleKey(key('return'), ctx())
    expect(result).not.toBeNull()
    expect(result!.effects[0]?.type).toBe('apply-theme')
    expect(result!.transition).toBe('navigation')
  })
})
