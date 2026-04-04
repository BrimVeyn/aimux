import { describe, expect, test } from 'bun:test'

import { createInitialState } from '../../src/state/store'
import { getStatusBarModel } from '../../src/ui/status-bar-model'

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
    const model = getStatusBarModel(state)

    expect(model.left).toContain('NAV')
    expect(model.right).toContain('Ctrl+g sessions')
    expect(model.right).toContain('Ctrl+n new')
  })

  test('shows close and reorder hints when an active tab exists', () => {
    const state = createInitialState()
    const model = getStatusBarModel(state, createTab('Claude'))

    expect(model.right).toContain('Ctrl+w close')
    expect(model.right).toContain('Shift+J/K reorder')
  })

  test('truncates long active tab labels in footer model', () => {
    const state = createInitialState()
    const model = getStatusBarModel(
      state,
      createTab('Claude session with a very long descriptive title')
    )

    expect(model.left).toContain('...')
    expect(model.left.length).toBeLessThan(100)
  })

  test('shows focused terminal hints for active tab', () => {
    const state = {
      ...createInitialState(),
      focusMode: 'terminal-input' as const,
    }
    const model = getStatusBarModel(state, createTab('Claude'))

    expect(model.left).toContain('Claude')
    expect(model.right).toContain('Ctrl+z unfocus')
  })

  test('shows modal-specific hints', () => {
    const state = {
      ...createInitialState(),
      focusMode: 'modal' as const,
    }
    const model = getStatusBarModel(state)

    expect(model.left).toContain('MODAL')
    expect(model.right).toContain('Enter confirm')
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

    const model = getStatusBarModel(state, createTab('Claude'))
    expect(model.left).toContain('Main Session')
  })

  test('shows restored tab restart hint', () => {
    const state = createInitialState()
    const model = getStatusBarModel(state, {
      ...createTab('Claude'),
      status: 'disconnected' as const,
    })

    expect(model.right).toContain('Ctrl+r restart restored tab')
  })
})
