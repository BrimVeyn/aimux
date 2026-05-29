import { describe, expect, mock, test } from 'bun:test'

import type { SessionBackend } from '../../src/session-backend/types'
import type { TabSession } from '../../src/state/types'

import { writePasteToTab, writeToTab } from '../../src/app-runtime/pty-write'
import { createDefaultTerminalModes } from '../../src/state/terminal-modes'

function createBackend(): Pick<SessionBackend, 'scrollViewportToBottom' | 'write'> {
  return {
    scrollViewportToBottom: mock(() => {}),
    write: mock(() => {}),
  }
}

function createTab(overrides?: Partial<TabSession>): TabSession {
  return {
    assistant: 'terminal',
    buffer: '',
    command: 'zsh',
    id: 'tab-1',
    status: 'running',
    terminalModes: createDefaultTerminalModes(),
    title: 'Terminal',
    ...overrides,
  }
}

describe('writeToTab', () => {
  test('scrolls viewport to bottom before writing when auto-bottom is enabled', () => {
    const backend = createBackend()
    const tab = createTab({
      viewport: {
        baseY: 10,
        cursorVisible: true,
        lines: [],
        viewportY: 4,
      },
    })

    writeToTab(backend as SessionBackend, 'tab-1', tab, 'input')

    // The backend owns scroll position; the snapshot it emits updates the
    // frontend mirror, so no scroll-intent dispatch is needed here.
    expect(backend.scrollViewportToBottom).toHaveBeenCalledWith('tab-1')
    expect(backend.write).toHaveBeenCalledWith('tab-1', 'input')
  })

  test('preserves scrollback when auto-bottom is disabled', () => {
    const backend = createBackend()
    const tab = createTab({
      viewport: {
        baseY: 10,
        cursorVisible: true,
        lines: [],
        viewportY: 4,
      },
    })

    writeToTab(backend as SessionBackend, 'tab-1', tab, 'input', { autoBottom: false })

    expect(backend.scrollViewportToBottom).not.toHaveBeenCalled()
    expect(backend.write).toHaveBeenCalledWith('tab-1', 'input')
  })

  test('writes directly when no viewport sync is needed', () => {
    const backend = createBackend()
    const tab = createTab()

    writeToTab(backend as SessionBackend, 'tab-1', tab, 'input')

    expect(backend.scrollViewportToBottom).not.toHaveBeenCalled()
    expect(backend.write).toHaveBeenCalledWith('tab-1', 'input')
  })
})

describe('writePasteToTab', () => {
  test('scrolls viewport to bottom when pasting into a scrolled tab', () => {
    const backend = createBackend()
    const tab = createTab({
      viewport: {
        baseY: 10,
        cursorVisible: true,
        lines: [],
        viewportY: 4,
      },
    })

    writePasteToTab(backend as SessionBackend, 'tab-1', tab, 'hello')

    expect(backend.scrollViewportToBottom).toHaveBeenCalledWith('tab-1')
    expect(backend.write).toHaveBeenCalledWith('tab-1', 'hello')
  })

  test('wraps payload when bracketed paste mode is enabled', () => {
    const backend = createBackend()
    const tab = createTab({
      terminalModes: { ...createDefaultTerminalModes(), bracketedPasteMode: true },
    })

    writePasteToTab(backend as SessionBackend, 'tab-1', tab, 'hello')

    expect(backend.write).toHaveBeenCalledWith('tab-1', '\x1b[200~hello\x1b[201~')
  })

  test('writes plain payload when tab is missing', () => {
    const backend = createBackend()

    writePasteToTab(backend as SessionBackend, 'tab-1', undefined, 'hello')

    expect(backend.write).toHaveBeenCalledWith('tab-1', 'hello')
  })
})
