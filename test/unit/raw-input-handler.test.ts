import { describe, expect, mock, test } from 'bun:test'

import type { FocusMode } from '../../src/state/types'

import { buildPtyPastePayload } from '../../src/input/paste'
import { createRawInputHandler } from '../../src/input/raw-input-handler'

function setup(overrides?: {
  focusMode?: FocusMode
  activeTabId?: string | null
  bracketedPasteModeEnabled?: boolean
}) {
  const focusMode = overrides?.focusMode ?? 'terminal-input'
  const activeTabId: string | null =
    overrides && 'activeTabId' in overrides ? (overrides.activeTabId ?? null) : 'tab-1'
  const bracketedPasteModeEnabled = overrides?.bracketedPasteModeEnabled ?? false
  const writeToPty = mock((_tabId: string, _data: string) => {})
  const leaveTerminalInput = mock(() => {})
  const toggleSidebar = mock(() => {})

  const handler = createRawInputHandler({
    getFocusMode: () => focusMode,
    getActiveTabId: () => activeTabId,
    getContentOrigin: () => ({ x: 0, y: 0, cols: 80, rows: 24 }),
    getMousePassthroughEnabled: () => true,
    getBracketedPasteModeEnabled: () => bracketedPasteModeEnabled,
    writeToPty,
    leaveTerminalInput,
    toggleSidebar,
  })

  return { handler, writeToPty, leaveTerminalInput, toggleSidebar }
}

describe('createRawInputHandler', () => {
  test('buildPtyPastePayload wraps only when bracketed paste is enabled', () => {
    expect(buildPtyPastePayload('hello', false)).toBe('hello')
    expect(buildPtyPastePayload('hello', true)).toBe('\x1b[200~hello\x1b[201~')
  })

  test('forwards raw keyboard sequences to PTY in terminal-input mode', () => {
    const { handler, writeToPty } = setup()
    expect(handler('\x1b[A')).toBe(true)
    expect(writeToPty).toHaveBeenCalledWith('tab-1', '\x1b[A')
  })

  test('passes through when not in terminal-input mode', () => {
    const { handler, writeToPty } = setup({ focusMode: 'navigation' })
    expect(handler('\x1b[A')).toBe(false)
    expect(writeToPty).not.toHaveBeenCalled()
  })

  test('passes through when no active tab', () => {
    const { handler, writeToPty } = setup({ activeTabId: null })
    expect(handler('\x1b[A')).toBe(false)
    expect(writeToPty).not.toHaveBeenCalled()
  })

  test('leaves terminal-input on Ctrl+Z even without an active tab', () => {
    const { handler, leaveTerminalInput, writeToPty } = setup({ activeTabId: null })
    expect(handler('\x1a')).toBe(true)
    expect(leaveTerminalInput).toHaveBeenCalled()
    expect(writeToPty).not.toHaveBeenCalled()
  })

  test('intercepts raw Ctrl+Z and leaves terminal-input', () => {
    const { handler, leaveTerminalInput, writeToPty } = setup()
    expect(handler('\x1a')).toBe(true)
    expect(leaveTerminalInput).toHaveBeenCalled()
    expect(writeToPty).not.toHaveBeenCalled()
  })

  test('intercepts Kitty protocol Ctrl+Z and leaves terminal-input', () => {
    const { handler, leaveTerminalInput, writeToPty } = setup()
    expect(handler('\x1b[122;5u')).toBe(true)
    expect(leaveTerminalInput).toHaveBeenCalled()
    expect(writeToPty).not.toHaveBeenCalled()
  })

  test('toggles sidebar on raw Ctrl+B in terminal-input', () => {
    const { handler, toggleSidebar, writeToPty } = setup()
    expect(handler('\x02')).toBe(true)
    expect(toggleSidebar).toHaveBeenCalled()
    expect(writeToPty).not.toHaveBeenCalled()
  })

  test('toggles sidebar on Kitty Ctrl+B in terminal-input', () => {
    const { handler, toggleSidebar, writeToPty } = setup()
    expect(handler('\x1b[98;5u')).toBe(true)
    expect(toggleSidebar).toHaveBeenCalled()
    expect(writeToPty).not.toHaveBeenCalled()
  })

  test('forwards printable characters', () => {
    const { handler, writeToPty } = setup()
    expect(handler('a')).toBe(true)
    expect(writeToPty).toHaveBeenCalledWith('tab-1', 'a')
  })

  test('normalizes Kitty Ctrl+C to ETX', () => {
    const { handler, writeToPty } = setup()
    expect(handler('\x1b[99;5u')).toBe(true)
    expect(writeToPty).toHaveBeenCalledWith('tab-1', '\x03')
  })

  test('normalizes Kitty Ctrl+L to form feed', () => {
    const { handler, writeToPty } = setup()
    expect(handler('\x1b[108;5u')).toBe(true)
    expect(writeToPty).toHaveBeenCalledWith('tab-1', '\f')
  })

  test('normalizes Kitty Ctrl+/ to unit separator', () => {
    const { handler, writeToPty } = setup()
    expect(handler('\x1b[47;5u')).toBe(true)
    expect(writeToPty).toHaveBeenCalledWith('tab-1', '\x1f')
  })

  test('forwards raw bracketed paste content without wrappers when inner mode is disabled', () => {
    const { handler, writeToPty, toggleSidebar, leaveTerminalInput } = setup()
    expect(handler('\x1b[200~hello\nworld\x1b[201~')).toBe(true)
    expect(writeToPty).toHaveBeenCalledWith('tab-1', 'hello\nworld')
    expect(toggleSidebar).not.toHaveBeenCalled()
    expect(leaveTerminalInput).not.toHaveBeenCalled()
  })

  test('preserves bracketed paste wrappers when inner mode is enabled', () => {
    const { handler, writeToPty } = setup({ bracketedPasteModeEnabled: true })
    expect(handler('\x1b[200~hello\nworld\x1b[201~')).toBe(true)
    expect(writeToPty).toHaveBeenCalledWith('tab-1', '\x1b[200~hello\nworld\x1b[201~')
  })

  test('does not treat pasted Ctrl+B or Ctrl+Z as shortcuts', () => {
    const { handler, writeToPty, toggleSidebar, leaveTerminalInput } = setup()
    expect(handler('\x1b[200~\x02\x1a\x1b[201~')).toBe(true)
    expect(writeToPty).toHaveBeenCalledWith('tab-1', '\x02\x1a')
    expect(toggleSidebar).not.toHaveBeenCalled()
    expect(leaveTerminalInput).not.toHaveBeenCalled()
  })

  test('collects split bracketed paste sequences across calls', () => {
    const { handler, writeToPty } = setup({ bracketedPasteModeEnabled: true })
    expect(handler('\x1b[200~hello')).toBe(true)
    expect(writeToPty).not.toHaveBeenCalled()
    expect(handler('\nworld\x1b[201~')).toBe(true)
    expect(writeToPty).toHaveBeenCalledWith('tab-1', '\x1b[200~hello\nworld\x1b[201~')
  })
})
