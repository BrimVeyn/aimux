import { getDefaultKeymapConfig } from '@brimveyn/aimux-config'
import { describe, expect, test } from 'bun:test'

import type { KeyInput, ModeContext } from '../../src/input/modes/types'

import { registerAllModes } from '../../src/input/modes/handlers'
import { getHandler } from '../../src/input/modes/registry'
import { createInitialState } from '../../src/state/store'

registerAllModes(getDefaultKeymapConfig())

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

  test('navigation: Ctrl+W is a leader prefix (no immediate action)', () => {
    const handler = requireValue(getHandler('navigation'), 'Missing navigation handler')
    const result = handler.handleKey(key('w', { ctrl: true }), ctx({ activeTabId: 'tab-1' }))
    // Leader waits for the next chord, so actions/effects are empty.
    expect(result?.actions).toEqual([])
    expect(result?.effects).toEqual([])
  })

  test('navigation: dd chord dispatches close-active-tab', () => {
    const handler = requireValue(getHandler('navigation'), 'Missing navigation handler')
    const context = ctx({ activeTabId: 'tab-1' })
    const first = requireValue(handler.handleKey(key('d'), context), 'Expected dd prefix result')
    expect(first.actions).toEqual([])
    const second = requireValue(handler.handleKey(key('d'), context), 'Expected dd close result')
    expect(second.actions).toEqual([{ type: 'close-active-tab' }])
    expect(second.effects).toEqual([{ tabId: 'tab-1', type: 'close-tab' }])
  })

  test('navigation: dd chord resets on non-d key', () => {
    const handler = requireValue(getHandler('navigation'), 'Missing navigation handler')
    const context = ctx({ activeTabId: 'tab-1' })
    handler.handleKey(key('d'), context)
    const interrupt = requireValue(handler.handleKey(key('j'), context), 'Expected j result')
    expect(interrupt.actions).toEqual([{ delta: 1, type: 'move-active-tab' }])
    // Now a single d should only arm the chord, not close
    const armed = requireValue(handler.handleKey(key('d'), context), 'Expected armed result')
    expect(armed.actions).toEqual([])
  })

  test('navigation: Ctrl+Z opens sidebar when hidden, no-op when visible', () => {
    const handler = requireValue(getHandler('navigation'), 'Missing navigation handler')
    const hiddenCtx = ctx()
    hiddenCtx.state.sidebar = { ...hiddenCtx.state.sidebar, visible: false }
    const openResult = requireValue(
      handler.handleKey(key('z', { ctrl: true }), hiddenCtx),
      'Expected Ctrl+Z result'
    )
    expect(openResult.actions).toEqual([{ type: 'toggle-sidebar' }])

    const visibleCtx = ctx()
    visibleCtx.state.sidebar = { ...visibleCtx.state.sidebar, visible: true }
    const noopResult = requireValue(
      handler.handleKey(key('z', { ctrl: true }), visibleCtx),
      'Expected Ctrl+Z noop result'
    )
    expect(noopResult.actions).toEqual([])
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
    expect(result.transition).toBe('modal.session-picker.filtering')
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
    const handler = requireValue(getHandler('modal.help.filtering'), 'Missing help handler')
    const result = requireValue(
      handler.handleKey(key('escape'), ctx()),
      'Expected help modal close result'
    )
    expect(result.actions).toEqual([{ type: 'close-modal' }])
    expect(result.transition).toBeUndefined()
  })

  test('terminal-input: Ctrl+Z resolves to leave-terminal-input', () => {
    const handler = requireValue(getHandler('terminal-input'), 'Missing terminal-input handler')
    const result = requireValue(
      handler.handleKey(key('z', { ctrl: true }), ctx()),
      'Expected Ctrl+Z result'
    )
    expect(result.transition).toBe('navigation')
    expect(result.actions).toContainEqual({ focusMode: 'navigation', type: 'set-focus-mode' })
  })

  test('terminal-input: <leader> (Ctrl+W) is now a prefix (enter-layout on timeout)', () => {
    // Ctrl+W is both bound alone (→ enter-layout) and as a prefix for
    // <leader>b / <leader>1..9 session-bar shortcuts. The trie therefore
    // waits for a continuation; handleKey returns an empty pending result.
    // The exact binding fires via the handler's timeout callback, which is
    // covered by sequence-resolver tests.
    const handler = requireValue(getHandler('terminal-input'), 'Missing terminal-input handler')
    const result = handler.handleKey(key('w', { ctrl: true }), ctx())
    expect(result?.actions).toEqual([])
    expect(result?.effects).toEqual([])
    expect(result?.transition).toBeUndefined()
  })

  test('terminal-input: Ctrl+B resolves to toggle-sidebar', () => {
    const handler = requireValue(getHandler('terminal-input'), 'Missing terminal-input handler')
    const result = requireValue(
      handler.handleKey(key('b', { ctrl: true }), ctx()),
      'Expected Ctrl+B result'
    )
    expect(result.actions).toContainEqual({ type: 'toggle-sidebar' })
  })

  test('terminal-input: unbound keys (Ctrl+L) return null', () => {
    const handler = requireValue(getHandler('terminal-input'), 'Missing terminal-input handler')
    expect(handler.handleKey(key('l', { ctrl: true }), ctx())).toBeNull()
  })

  test('modal.session-picker: escape blocked without currentSessionId', () => {
    const handler = requireValue(
      getHandler('modal.session-picker.filtering'),
      'Missing session-picker handler'
    )
    const result = handler.handleKey(key('escape'), ctx({ currentSessionId: null }))
    expect(result).toBeNull()
  })

  test('modal.session-picker: escape works with currentSessionId', () => {
    const handler = requireValue(
      getHandler('modal.session-picker.filtering'),
      'Missing session-picker handler'
    )
    const result = requireValue(
      handler.handleKey(key('escape'), ctx({ currentSessionId: 's-1' })),
      'Expected session-picker escape result'
    )
    expect(result.transition).toBe('navigation')
  })

  test('modal.theme-picker: return confirms theme', () => {
    const handler = requireValue(
      getHandler('modal.theme-picker.filtering'),
      'Missing theme-picker handler'
    )
    const result = requireValue(
      handler.handleKey(key('return'), ctx()),
      'Expected theme confirmation result'
    )
    expect(result.effects[0]?.type).toBe('apply-theme')
    expect(result.transition).toBe('navigation')
  })
})
