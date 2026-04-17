import { getDefaultKeymapConfig } from '@brimveyn/aimux-config'
import { describe, expect, test } from 'bun:test'

import { createInitialState } from '../../src/state/store'
import { getStatusBarModel } from '../../src/ui/status-bar-model'

const CONFIG = getDefaultKeymapConfig()

function createTab(title: string) {
  return {
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
    title,
  }
}

describe('getStatusBarModel', () => {
  test('shows navigation hints when browsing tabs', () => {
    const state = createInitialState()
    const model = getStatusBarModel(state, undefined, CONFIG)

    expect(model.left).toContain('no session')
    expect(model.left).toContain('no tab')
    // Hints derive from default keymap descriptions.
    expect(model.right).toContain('Quit')
    expect(model.right).toContain('New tab')
  })

  test('truncates long active tab labels in footer model', () => {
    const state = createInitialState()
    const model = getStatusBarModel(
      state,
      createTab('Claude session with a very long descriptive title'),
      CONFIG
    )

    expect(model.left).toContain('...')
    expect(model.left.length).toBeLessThan(100)
  })

  test('shows focused terminal hints for active tab', () => {
    const state = {
      ...createInitialState(),
      focusMode: 'terminal-input' as const,
    }
    const model = getStatusBarModel(state, createTab('Claude'), CONFIG)

    expect(model.left).toContain('Claude')
    expect(model.right).toContain('Leave insert')
  })

  test('shows modal-specific hints for session picker', () => {
    const state = {
      ...createInitialState(),
      focusMode: 'modal' as const,
      modal: {
        cursorPos: 0,
        editBuffer: null,
        selectedIndex: 0,
        sessionTargetId: null,
        type: 'session-picker' as const,
      },
    }
    const model = getStatusBarModel(state, undefined, CONFIG)

    expect(model.left).toContain('no session')
    expect(model.right).toContain('Open')
  })

  test('shows current session name when active', () => {
    const state = {
      ...createInitialState({}, [
        {
          createdAt: '2024-01-01T00:00:00.000Z',
          id: 'session-1',
          lastOpenedAt: '2024-01-01T00:00:00.000Z',
          name: 'Main Session',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ]),
      currentSessionId: 'session-1',
    }

    const model = getStatusBarModel(state, createTab('Claude'), CONFIG)
    expect(model.left).toContain('Main Session')
  })

  test('shows git-mode hints when in git focus', () => {
    const state = {
      ...createInitialState(),
      focusMode: 'git' as const,
    }
    const model = getStatusBarModel(state, undefined, CONFIG)

    expect(model.right).toContain('Exit git')
  })
})
