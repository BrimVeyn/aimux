import { getDefaultKeymapConfig } from '@brimveyn/aimux-config'
import { describe, expect, test } from 'bun:test'

import { createInitialState } from '../../src/state/store'
import { getStatusBarModel, type StatusBarModel } from '../../src/ui/status-bar-model'

const CONFIG = getDefaultKeymapConfig()

function identityText(model: StatusBarModel): string {
  return model.projectSegments.map((seg) => seg.text).join('')
}

describe('getStatusBarModel', () => {
  test('shows navigation hints when browsing tabs', () => {
    const state = createInitialState()
    const model = getStatusBarModel(state, CONFIG)

    expect(identityText(model)).toContain('no project')
    // Hints derive from default keymap descriptions.
    expect(model.right).toContain('Quit')
    expect(model.right).toContain('New tab')
  })

  test('shows focused terminal hints in terminal-input mode', () => {
    const state = {
      ...createInitialState(),
      focusMode: 'terminal-input' as const,
    }
    const model = getStatusBarModel(state, CONFIG)

    expect(model.right).toContain('Leave insert')
  })

  test('shows modal-specific hints for project picker', () => {
    const state = {
      ...createInitialState(),
      focusMode: 'modal' as const,
      modal: {
        cursorPos: 0,
        editBuffer: null,
        projectTargetId: null,
        selectedIndex: 0,
        type: 'project-picker' as const,
      },
    }
    const model = getStatusBarModel(state, CONFIG)

    expect(identityText(model)).toContain('no project')
    expect(model.right).toContain('Open')
  })

  test('shows current project name when active', () => {
    const state = {
      ...createInitialState({}, [
        {
          createdAt: '2024-01-01T00:00:00.000Z',
          id: 'project-1',
          lastOpenedAt: '2024-01-01T00:00:00.000Z',
          name: 'Main Project',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ]),
      currentProjectId: 'project-1',
    }

    const model = getStatusBarModel(state, CONFIG)
    expect(identityText(model)).toContain('Main Project')
  })

  test('shows git-mode hints when in git focus', () => {
    const state = {
      ...createInitialState(),
      focusMode: 'git' as const,
    }
    const model = getStatusBarModel(state, CONFIG)

    expect(model.right).toContain('Stage')
  })
})
