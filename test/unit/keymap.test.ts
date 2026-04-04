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
    ctrl: opts.ctrl ?? false,
    meta: false,
    name,
    sequence: opts.sequence ?? name,
    shift: opts.shift ?? false,
  }
}

function ctx(overrides?: Partial<ReturnType<typeof createInitialState>>): ModeContext {
  const state = createInitialState({}, [], [], false)
  return { state: { ...state, ...overrides } }
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message)
  }

  return value
}

describe('mode handlers', () => {
  test('navigation: maps j/k to move-active-tab', () => {
    const handler = requireValue(getHandler('navigation'), 'Missing navigation handler')
    const result = requireValue(handler.handleKey(key('j'), ctx()), 'Expected navigation result')
    expect(result.actions).toEqual([{ delta: 1, type: 'move-active-tab' }])
  })

  test('navigation: Ctrl+W dispatches close-active-tab', () => {
    const handler = requireValue(getHandler('navigation'), 'Missing navigation handler')
    const result = requireValue(
      handler.handleKey(key('w', { ctrl: true }), ctx({ activeTabId: 'tab-1' })),
      'Expected close-active-tab result'
    )
    expect(result.actions).toEqual([{ type: 'close-active-tab' }])
    expect(result.effects).toEqual([{ tabId: 'tab-1', type: 'close-tab' }])
  })

  test('navigation: Ctrl+R triggers restart-tab effect', () => {
    const tab = {
      assistant: 'claude' as const,
      buffer: '',
      command: 'claude',
      id: 'tab-1',
      status: 'running' as const,
      terminalModes: {
        alternateScrollMode: false,
        bracketedPasteMode: false,
        isAlternateBuffer: false,
        mouseTrackingMode: 'none' as const,
        sendFocusMode: false,
      },
      title: 'Claude',
    }
    const handler = requireValue(getHandler('navigation'), 'Missing navigation handler')
    const result = requireValue(
      handler.handleKey(key('r', { ctrl: true }), ctx({ activeTabId: 'tab-1', tabs: [tab] })),
      'Expected restart result'
    )
    expect(result.effects[0]?.type).toBe('restart-tab')
  })

  test('navigation: Ctrl+G opens session picker', () => {
    const handler = requireValue(getHandler('navigation'), 'Missing navigation handler')
    const result = requireValue(
      handler.handleKey(key('g', { ctrl: true }), ctx()),
      'Expected session picker result'
    )
    expect(result.actions).toEqual([{ type: 'open-session-picker' }])
    expect(result.transition).toBe('modal.session-picker')
  })

  test('navigation: Shift+J reorders tab', () => {
    const handler = requireValue(getHandler('navigation'), 'Missing navigation handler')
    const result = requireValue(
      handler.handleKey(key('j', { shift: true }), ctx()),
      'Expected reorder result'
    )
    expect(result.actions).toEqual([{ delta: 1, type: 'reorder-active-tab' }])
  })

  test('navigation: Shift+K reorders tab up', () => {
    const handler = requireValue(getHandler('navigation'), 'Missing navigation handler')
    const result = requireValue(
      handler.handleKey(key('k', { shift: true }), ctx()),
      'Expected reorder-up result'
    )
    expect(result.actions).toEqual([{ delta: -1, type: 'reorder-active-tab' }])
  })

  test('navigation: i transitions to terminal-input', () => {
    const handler = requireValue(getHandler('navigation'), 'Missing navigation handler')
    const result = requireValue(
      handler.handleKey(key('i'), ctx({ activeTabId: 'tab-1' })),
      'Expected terminal-input transition'
    )
    expect(result.transition).toBe('terminal-input')
  })

  test('modal.help: escape closes modal', () => {
    const handler = requireValue(getHandler('modal.help'), 'Missing help handler')
    const result = requireValue(
      handler.handleKey(key('escape'), ctx()),
      'Expected help modal close result'
    )
    expect(result.actions).toEqual([{ type: 'close-modal' }])
    expect(result.transition).toBe('navigation')
  })

  test('modal.help: Ctrl+B is not handled', () => {
    const handler = requireValue(getHandler('modal.help'), 'Missing help handler')
    const result = handler.handleKey(key('b', { ctrl: true }), ctx())
    expect(result).toBeNull()
  })

  test('terminal-input: all keys return null', () => {
    const handler = requireValue(getHandler('terminal-input'), 'Missing terminal-input handler')
    expect(handler.handleKey(key('z', { ctrl: true }), ctx())).toBeNull()
    expect(handler.handleKey(key('l', { ctrl: true }), ctx())).toBeNull()
    expect(handler.handleKey(key('w', { ctrl: true }), ctx())).toBeNull()
  })

  test('modal.session-picker: escape blocked without currentSessionId', () => {
    const handler = requireValue(
      getHandler('modal.session-picker'),
      'Missing session-picker handler'
    )
    const result = handler.handleKey(key('escape'), ctx({ currentSessionId: null }))
    expect(result).toBeNull()
  })

  test('modal.session-picker: escape works with currentSessionId', () => {
    const handler = requireValue(
      getHandler('modal.session-picker'),
      'Missing session-picker handler'
    )
    const result = requireValue(
      handler.handleKey(key('escape'), ctx({ currentSessionId: 's-1' })),
      'Expected session-picker escape result'
    )
    expect(result.transition).toBe('navigation')
  })

  test('modal.session-picker: n opens create-session', () => {
    const handler = requireValue(
      getHandler('modal.session-picker'),
      'Missing session-picker handler'
    )
    const result = requireValue(
      handler.handleKey(key('n'), ctx()),
      'Expected create-session transition'
    )
    expect(result.transition).toBe('modal.create-session')
  })

  test('modal.snippet-picker: n opens snippet-editor', () => {
    const handler = requireValue(
      getHandler('modal.snippet-picker'),
      'Missing snippet-picker handler'
    )
    const result = requireValue(
      handler.handleKey(key('n'), ctx()),
      'Expected snippet-editor transition'
    )
    expect(result.transition).toBe('modal.snippet-editor')
  })

  test('modal.new-tab: e enters command edit', () => {
    const handler = requireValue(getHandler('modal.new-tab'), 'Missing new-tab handler')
    const result = requireValue(
      handler.handleKey(key('e'), ctx()),
      'Expected command edit transition'
    )
    expect(result.transition).toBe('modal.new-tab.command-edit')
  })

  test('modal.theme-picker: return confirms theme', () => {
    const handler = requireValue(getHandler('modal.theme-picker'), 'Missing theme-picker handler')
    const result = requireValue(
      handler.handleKey(key('return'), ctx()),
      'Expected theme confirmation result'
    )
    expect(result.effects[0]?.type).toBe('apply-theme')
    expect(result.transition).toBe('navigation')
  })
})
